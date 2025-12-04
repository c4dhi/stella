"""
Aggregator that synthesizes expert findings into a natural, conversational response.
Streams the response token-by-token while resolving conflicts between experts.

This version yields AgentOutput messages instead of using StreamService.
Includes timekeeper processing for state machine integration.
TRUE TOKEN STREAMING: Streams synthesis tokens to frontend as they arrive from LLM.
"""

import asyncio
import re
import json
import uuid
from typing import AsyncIterator, Dict, Any, List, Optional
from dataclasses import dataclass, field

from stella_agent_sdk.messages.output import AgentOutput

from stella_agent.llm.service import (
    LLMService,
    LLMConfig,
    LLMStreamingCallback,
    LLMMessage,
    LLMResponse,
)
from stella_agent.models.expert_result import ExpertResult


@dataclass
class TimekeeperAnalysis:
    """Parsed timekeeper expert analysis."""
    turns_without_deliverables: int = 0
    is_stuck: bool = False
    mode: str = "loose"
    recommendation: str = "continue"
    suggested_deliverables: Dict[str, Any] = field(default_factory=dict)
    reasoning: str = ""


@dataclass
class AggregatorResult:
    """Result from expert findings aggregation."""
    consolidated_response: str
    confidence_score: float
    conflicting_findings: List[str]
    transcript_id: str
    processing_time_ms: int


class StreamingAggregatorCallback(LLMStreamingCallback):
    """Callback for TRUE streaming aggregator synthesis.

    Streams each token to an async queue for immediate frontend delivery.
    No buffering or mocking - tokens are sent as they arrive from the LLM.
    """

    def __init__(self, transcript_id: str, token_queue: asyncio.Queue):
        self.transcript_id = transcript_id
        self.accumulated_text = ""
        self.token_queue = token_queue

    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Stream each token immediately to the queue."""
        self.accumulated_text = accumulated_text
        # Put token in queue for immediate streaming to frontend
        await self.token_queue.put(("token", token))

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete. Signal end of stream."""
        await self.token_queue.put(("complete", self.accumulated_text))

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        print(f"[Aggregator] Streaming error: {error}")
        await self.token_queue.put(("error", str(error)))


@dataclass
class Aggregator:
    """Synthesizes expert findings into natural responses."""

    llm_service: LLMService
    config: Optional[LLMConfig] = None
    cancelled: bool = False

    # Store last result for external access
    last_result: Optional[AggregatorResult] = None

    def __post_init__(self):
        if self.config is None:
            self.config = LLMConfig(
                model=self.llm_service.default_config.model,
                temperature=0.7,  # Higher temperature for natural conversation
                streaming=True,
                provider=self.llm_service.default_config.provider,
                base_url=self.llm_service.default_config.base_url
            )

        self.synthesis_prompt_base = """You are synthesizing expert analysis into a natural, conversational response.

Your role is to:
1. Gracefully redirect potentially problematic conversations
2. Acknowledge the user's interest without dwelling on issues
3. Maintain a helpful and supportive tone
4. Keep responses brief and natural (~30-50 words)

TONE GUIDELINES:
- Sound like a helpful, understanding friend
- Don't be preachy or judgmental
- Use natural speech patterns
- Include natural pauses with commas
- Ask only ONE question per message maximum

RESPONSE STRUCTURE:
1. Acknowledge the user's question/interest briefly
2. Provide relevant guidance based on expert analysis
3. If needed, gently redirect the conversation
4. End with a supportive comment or single question

Remember:
- Expert findings help you understand the situation
- Your response should be natural and conversational
- Focus on being helpful rather than warning about dangers
- Keep it brief - target ~30-50 words"""

        self.plan_focused_prompt = """
*** IMPORTANT: CONVERSATION PLAN ACTIVE ***
You are having a structured conversation with specific goals. After addressing the user's concern:

HIGHEST PRIORITY: Guide the conversation back to collecting the pending deliverables.

{plan_context}

YOUR RESPONSE MUST:
1. Briefly acknowledge/address the user's question using expert insights
2. Naturally transition back to the conversation goal
3. Ask about the NEXT PENDING DELIVERABLE in a conversational way
4. Keep the overall tone warm and supportive

Example flow:
- User asks off-topic question about health
- You: "That's a good question to discuss with your doctor. By the way, [transition to deliverable] - what's your name so I can address you properly?"

DO NOT get stuck on the off-topic subject. Redirect smoothly to collect information.
*** END PLAN CONTEXT ***"""

    def cancel(self):
        """Cancel ongoing processing."""
        self.cancelled = True

    async def synthesize(
        self,
        session_id: str,
        user_input: str,
        expert_results: List[ExpertResult],
        input_gate_message: str = "",
        context: str = "",
        state_machine_context: Optional[Dict[str, Any]] = None
    ) -> AsyncIterator[AgentOutput]:
        """
        Synthesize expert findings with TRUE streaming output.

        Implements real-time token streaming:
        - Each token from LLM is immediately streamed to frontend
        - No buffering, no artificial delays - true real-time streaming

        Args:
            session_id: Session identifier
            user_input: The user's input message
            expert_results: Results from expert analysis
            input_gate_message: Optional message from input gate
            context: Conversation history context
            state_machine_context: Optional plan/deliverable context from state machine

        Yields AgentOutput messages and stores result in self.last_result.
        """
        self.cancelled = False
        start_time = asyncio.get_event_loop().time()
        transcript_id = f"agg_{uuid.uuid4().hex[:8]}"

        print(f"[Aggregator] Synthesizing {len(expert_results)} expert findings")

        if not self.llm_service.get_available_providers():
            yield AgentOutput.error(
                session_id,
                "AI synthesis engine not available",
                error_type="aggregator_llm_unavailable",
                recoverable=False
            )
            return

        if not expert_results:
            yield AgentOutput.error(
                session_id,
                "No expert analysis results to synthesize",
                error_type="no_expert_findings",
                recoverable=True
            )
            return

        # Note: AGGREGATING status is sent by agent.py before calling this method
        # Analyze conflicts and consensus
        conflict_analysis = self._analyze_conflicts(expert_results)

        # Create async queue for true token streaming
        token_queue: asyncio.Queue = asyncio.Queue()

        # Create streaming callback with queue
        callback = StreamingAggregatorCallback(transcript_id, token_queue)

        # Build system prompt - add plan context if available
        system_prompt = self._build_system_prompt(state_machine_context)

        # Build synthesis prompt
        synthesis_input = self._build_synthesis_prompt(
            user_input=user_input,
            expert_results=expert_results,
            conflict_analysis=conflict_analysis,
            input_gate_message=input_gate_message,
            context=context
        )

        try:
            # Prepare messages
            messages = [
                LLMMessage(role="system", content=system_prompt),
                LLMMessage(role="user", content=synthesis_input)
            ]

            # Debug: Show full prompt being sent to LLM
            yield AgentOutput.debug(
                session_id,
                "Full aggregator LLM prompt constructed",
                component="aggregator",
                stage="prompt_construction",
                system_prompt=system_prompt,
                user_message=synthesis_input,
                total_prompt_length=len(system_prompt) + len(synthesis_input)
            )

            # Start LLM generation in background task
            async def run_llm():
                return await self.llm_service.generate(
                    messages=messages,
                    config=self.config,
                    callback=callback,
                    component_name="aggregator"
                )

            llm_task = asyncio.create_task(run_llm())

            # Stream tokens from queue as they arrive (TRUE STREAMING)
            accumulated_response = ""
            final_response = ""

            while True:
                if self.cancelled:
                    llm_task.cancel()
                    return

                try:
                    # Wait for next token with timeout
                    event_type, content = await asyncio.wait_for(
                        token_queue.get(),
                        timeout=0.1
                    )

                    if event_type == "token":
                        # Stream token to frontend immediately (TRUE STREAMING)
                        accumulated_response += content
                        yield AgentOutput.text_chunk(
                            session_id,
                            accumulated_response,
                            transcript_id=transcript_id,
                            is_final=False
                        )

                    elif event_type == "complete":
                        # LLM finished - send final chunk and break
                        final_response = content
                        yield AgentOutput.text_chunk(
                            session_id,
                            final_response,
                            transcript_id=transcript_id,
                            is_final=True
                        )
                        break

                    elif event_type == "error":
                        # Error during streaming
                        raise Exception(content)

                except asyncio.TimeoutError:
                    # Check if LLM task is done
                    if llm_task.done():
                        # Drain any remaining items from queue
                        while not token_queue.empty():
                            event_type, content = token_queue.get_nowait()
                            if event_type == "token":
                                accumulated_response += content
                            elif event_type == "complete":
                                final_response = content
                        # Send final if we have content
                        if accumulated_response:
                            yield AgentOutput.text_chunk(
                                session_id,
                                accumulated_response,
                                transcript_id=transcript_id,
                                is_final=True
                            )
                        break
                    continue

            # Wait for LLM task to complete
            llm_response = await llm_task

            if self.cancelled:
                return

            response = final_response or llm_response.content

            # Calculate confidence
            confidence_score = self._calculate_confidence(expert_results, conflict_analysis)

            end_time = asyncio.get_event_loop().time()
            processing_time = int((end_time - start_time) * 1000)

            # Store result
            self.last_result = AggregatorResult(
                consolidated_response=response,
                confidence_score=confidence_score,
                conflicting_findings=conflict_analysis["conflicts"],
                transcript_id=transcript_id,
                processing_time_ms=processing_time
            )

            # Debug: Synthesis complete (no status needed - text_chunk with is_final=True is enough)
            yield AgentOutput.debug(
                session_id,
                f"Synthesis complete (confidence: {confidence_score:.2f}, time: {processing_time}ms)",
                component="aggregator",
                confidence=confidence_score,
                processing_time_ms=processing_time
            )

        except Exception as e:
            print(f"[Aggregator] Synthesis failed: {e}")
            yield AgentOutput.error(
                session_id,
                f"Synthesis failed: {str(e)}",
                error_type="aggregation_failure",
                recoverable=True
            )

    def _build_system_prompt(self, state_machine_context: Optional[Dict[str, Any]] = None) -> str:
        """
        Build the system prompt, optionally including plan context.

        If a plan is active with pending deliverables, adds instructions to
        guide the conversation back to collecting those deliverables.
        """
        base_prompt = self.synthesis_prompt_base

        # If no state machine context, use base prompt
        if not state_machine_context:
            return base_prompt

        # Check if there are pending deliverables
        deliverables = state_machine_context.get("deliverables", [])
        pending_deliverables = [d for d in deliverables if d.get("status") == "pending"]

        if not pending_deliverables:
            return base_prompt

        # Build plan context string
        plan_context_parts = []

        # Add current state info
        state = state_machine_context.get("state", {})
        if state:
            plan_context_parts.append(f"Current conversation state: {state.get('title', 'Unknown')}")
            if state.get('description'):
                plan_context_parts.append(f"Goal: {state.get('description')}")

        # Add current task info
        current_task = state_machine_context.get("current_task")
        if current_task:
            plan_context_parts.append(f"\nCurrent task: {current_task.get('description', '')}")
            if current_task.get('instruction'):
                plan_context_parts.append(f"Instruction: {current_task.get('instruction')}")

        # Add pending deliverables with the NEXT one highlighted
        if pending_deliverables:
            plan_context_parts.append("\nPENDING INFORMATION TO COLLECT:")
            for i, d in enumerate(pending_deliverables):
                marker = ">>> NEXT: " if i == 0 else "    "
                desc = d.get('description', d.get('key', 'Unknown'))
                examples = d.get('examples', [])
                example_str = f" (e.g., {', '.join(examples[:2])})" if examples else ""
                plan_context_parts.append(f"{marker}{desc}{example_str}")

        plan_context = "\n".join(plan_context_parts)

        # Combine base prompt with plan-focused instructions
        return base_prompt + "\n\n" + self.plan_focused_prompt.format(plan_context=plan_context)

    def _analyze_conflicts(self, expert_results: List[ExpertResult]) -> Dict[str, Any]:
        """Analyze conflicts and consensus among expert findings."""
        conflicts = []
        consensus = []

        successful = [r for r in expert_results if r.success]

        if len(successful) < 2:
            return {
                "conflicts": [],
                "consensus": [],
                "successful_experts": len(successful),
                "failed_experts": len(expert_results) - len(successful)
            }

        # Check for conflicting risk assessments
        high_risk = [r for r in successful if r.risks and len(r.risks) > 0]
        low_risk = [r for r in successful if not r.risks or len(r.risks) == 0]

        if high_risk and low_risk:
            high_names = [r.agent_name for r in high_risk]
            low_names = [r.agent_name for r in low_risk]
            conflicts.append(
                f"Risk disagreement: {', '.join(high_names)} identified risks, "
                f"{', '.join(low_names)} found no significant risks"
            )

        # Check for conflicting recommendations
        recommendations = [r.recommendation for r in successful if r.recommendation]
        unique_recommendations = list(set(recommendations))

        if len(unique_recommendations) > 2:
            conflicts.append(f"Multiple recommendations: {', '.join(unique_recommendations)}")

        # Find consensus
        all_findings = [r.findings.lower() for r in successful]
        keywords = ["safe", "proceed", "caution", "recommend", "avoid"]

        for keyword in keywords:
            mentions = [f for f in all_findings if keyword in f]
            if len(mentions) >= len(successful) // 2:
                consensus.append(f"Multiple experts mention: {keyword}")

        return {
            "conflicts": conflicts,
            "consensus": consensus,
            "successful_experts": len(successful),
            "failed_experts": len(expert_results) - len(successful)
        }

    def _calculate_confidence(
        self,
        expert_results: List[ExpertResult],
        conflict_analysis: Dict[str, Any]
    ) -> float:
        """Calculate overall confidence based on expert consensus."""
        if not expert_results:
            return 0.0

        successful = [r for r in expert_results if r.success]
        if not successful:
            return 0.1

        # Average confidence
        avg_confidence = sum(r.confidence for r in successful) / len(successful)

        # Penalty for conflicts
        conflict_penalty = min(0.3, len(conflict_analysis["conflicts"]) * 0.1)

        # Penalty for failures
        failure_rate = conflict_analysis["failed_experts"] / len(expert_results)
        failure_penalty = failure_rate * 0.2

        final = max(0.0, min(1.0, avg_confidence - conflict_penalty - failure_penalty))
        return round(final, 2)

    def _build_synthesis_prompt(
        self,
        user_input: str,
        expert_results: List[ExpertResult],
        conflict_analysis: Dict[str, Any],
        input_gate_message: str = "",
        context: str = ""
    ) -> str:
        """Build the synthesis prompt with expert findings."""
        # Format expert findings
        successful_text = []
        failed_text = []

        for result in expert_results:
            if result.success:
                summary = f"**{result.agent_name}** (confidence: {result.confidence:.1f}):\n"
                summary += f"Findings: {result.findings}\n"
                summary += f"Risks: {', '.join(result.risks) or 'None identified'}\n"
                summary += f"Recommendation: {result.recommendation or 'None'}"
                successful_text.append(summary)
            else:
                failed = f"**{result.agent_name}** (FAILED):\n"
                failed += f"Error: {result.error_message or 'Unknown error'}"
                failed_text.append(failed)

        # Build expert sections
        expert_sections = []
        if successful_text:
            expert_sections.append("Successful Expert Analysis:\n" + "\n\n".join(successful_text))
        if failed_text:
            expert_sections.append("Failed Expert Analysis:\n" + "\n\n".join(failed_text))

        expert_text = "\n\n".join(expert_sections)

        # Conflict info
        conflict_text = ""
        if conflict_analysis["conflicts"]:
            conflict_text = f"\n\nConflicts identified:\n" + "\n".join(conflict_analysis["conflicts"])

        # Gate context
        gate_context = ""
        if input_gate_message:
            gate_context = f"\n\nPrevious message to user: \"{input_gate_message}\"\nContinue seamlessly from this message."

        # Conversation context
        context_text = ""
        if context:
            context_text = f"\n\nConversation context:\n{context}"

        return f"""User Query: "{user_input}"{context_text}

Expert Analysis Results:
{expert_text}{conflict_text}{gate_context}

Please synthesize this information into a helpful, natural response that:
1. Directly addresses the user's question
2. Incorporates relevant expert insights
3. Acknowledges any uncertainties or disagreements naturally
4. Sounds conversational and human
5. Keeps to ~30-50 words
6. Asks at most ONE follow-up question

If there was a previous message, continue seamlessly from it."""

    def process_timekeeper_analysis(
        self, expert_results: List[ExpertResult]
    ) -> Optional[TimekeeperAnalysis]:
        """
        Extract and parse timekeeper expert analysis from expert results.

        Args:
            expert_results: List of expert findings including timekeeper

        Returns:
            TimekeeperAnalysis if timekeeper result found, None otherwise
        """
        # Find timekeeper result
        timekeeper_result = None
        for result in expert_results:
            if result.agent_name.lower() == "timekeeper":
                timekeeper_result = result
                break

        if not timekeeper_result or not timekeeper_result.success:
            return None

        findings = timekeeper_result.findings

        # Parse structured timekeeper output
        analysis = TimekeeperAnalysis()

        # Extract turns without deliverables
        turns_match = re.search(
            r'turns[_\s]?without[_\s]?deliverables?[:\s]*(\d+)',
            findings,
            re.IGNORECASE
        )
        if turns_match:
            analysis.turns_without_deliverables = int(turns_match.group(1))

        # Extract stuck status
        if re.search(r'\b(stuck|stalled|blocked)\b', findings, re.IGNORECASE):
            analysis.is_stuck = True

        # Extract mode
        mode_match = re.search(r'mode[:\s]*(strict|loose)', findings, re.IGNORECASE)
        if mode_match:
            analysis.mode = mode_match.group(1).lower()

        # Extract recommendation
        rec_match = re.search(
            r'recommendation[:\s]*(continue|force[_\s]?transition|escalate)',
            findings,
            re.IGNORECASE
        )
        if rec_match:
            analysis.recommendation = rec_match.group(1).lower().replace(' ', '_')

        # Try to parse JSON deliverables if present
        json_match = re.search(r'suggested[_\s]?deliverables[:\s]*(\{[^}]+\})', findings)
        if json_match:
            try:
                analysis.suggested_deliverables = json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # Extract reasoning
        reasoning_match = re.search(r'reasoning[:\s]*(.+?)(?=\n|$)', findings, re.IGNORECASE)
        if reasoning_match:
            analysis.reasoning = reasoning_match.group(1).strip()

        return analysis

    def should_force_transition(self, analysis: TimekeeperAnalysis) -> bool:
        """
        Determine if a forced state transition should occur.

        Args:
            analysis: Parsed timekeeper analysis

        Returns:
            True if force transition is recommended
        """
        if analysis is None:
            return False

        # Force transition if explicitly recommended
        if analysis.recommendation == "force_transition":
            return True

        # Force transition if stuck in strict mode with too many failed turns
        if analysis.is_stuck and analysis.mode == "strict":
            if analysis.turns_without_deliverables >= 3:
                return True

        # Force transition in loose mode if severely stuck
        if analysis.is_stuck and analysis.mode == "loose":
            if analysis.turns_without_deliverables >= 5:
                return True

        return False

    def get_timekeeper_suggested_deliverables(
        self, expert_results: List[ExpertResult]
    ) -> Dict[str, Any]:
        """
        Get suggested deliverables from timekeeper analysis.

        Useful when the timekeeper suggests auto-completing deliverables
        to unstick a conversation.

        Args:
            expert_results: List of expert findings

        Returns:
            Dictionary of suggested deliverable values
        """
        analysis = self.process_timekeeper_analysis(expert_results)
        if analysis and analysis.suggested_deliverables:
            return analysis.suggested_deliverables
        return {}

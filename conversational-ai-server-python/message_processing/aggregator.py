"""
Aggregator that synthesizes expert findings into a natural, conversational response.
Streams the response token-by-token while resolving conflicts between experts.
"""
import asyncio
import re
import json
from typing import Dict, Any, List, Optional
from dataclasses import dataclass

from .stream_service import StreamService
from .llm_service import LLMService, LLMConfig, LLMProvider, LLMStreamingCallback, LLMMessage, LLMResponse


@dataclass
class AggregatorResult:
    """Result from expert findings aggregation."""
    consolidated_response: str
    confidence_score: float
    conflicting_findings: List[str]
    transcript_id: str
    processing_time_ms: int


class StreamingAggregatorCallback(LLMStreamingCallback):
    """Custom callback for streaming aggregator synthesis."""

    def __init__(self, stream_service: StreamService, transcript_id: str, tts_service=None, message_id: str = None):
        self.stream_service = stream_service
        self.transcript_id = transcript_id
        self.tts_service = tts_service
        self.accumulated_text = ""
        self.last_tts_text = ""
        self.message_id = message_id or transcript_id  # Use transcript_id as fallback message_id
        self.tts_ended = False  # Track if we've hit structural markers and should stop TTS

    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Stream tokens as they arrive."""
        self.accumulated_text = accumulated_text

        # Stream partial response to frontend
        await self.stream_service.send_transcript_chunk(
            text=self.accumulated_text,
            is_final=False,
            transcript_id=self.transcript_id,
            confidence=0.8
        )

        # Send new text to TTS for sentence processing with message tracking
        if self.tts_service and not self.tts_ended and len(self.accumulated_text) > len(self.last_tts_text):
            new_text_chunk = self.accumulated_text[len(self.last_tts_text):]

            # Check if this chunk contains structural markers (DELIVERABLES or STATE_TRANSITION)
            # If so, truncate before the marker and mark as final TTS sentence
            truncated_chunk = new_text_chunk
            for marker in ['DELIVERABLES:', 'STATE_TRANSITION:']:
                if marker in new_text_chunk:
                    # Cut off everything from the marker onwards
                    marker_pos = new_text_chunk.find(marker)
                    truncated_chunk = new_text_chunk[:marker_pos].strip()
                    self.tts_ended = True
                    print(f"[Aggregator] Detected {marker} in TTS chunk - truncating and ending TTS")
                    break

            # Only send to TTS if there's actual content after truncation
            if truncated_chunk:
                await self.tts_service.process_text_chunk(
                    truncated_chunk,
                    message_id=self.message_id,
                    stream_id=self.transcript_id
                )

            # If we hit a marker, clear buffer silently (don't speak buffered structural keywords)
            if self.tts_ended:
                await self.tts_service.clear_buffer()

            self.last_tts_text = self.accumulated_text

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete."""
        # Clear any remaining buffer (would only contain structural keywords at this point)
        if self.tts_service:
            await self.tts_service.clear_buffer()

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        print(f"[Aggregator] Streaming error: {error}")


class Aggregator:
    """Synthesizes expert findings into natural responses."""

    def __init__(self, stream_service: StreamService, tts_service=None, llm_service: Optional[LLMService] = None, task_manager=None):
        self.stream_service = stream_service
        self.tts_service = tts_service
        self.llm_service = llm_service or LLMService()
        self.task_manager = task_manager

        # Configuration for aggregator
        self.config = LLMConfig(
            model="gpt-4o-mini",
            temperature=0.7,  # Higher temperature for more natural conversation
            streaming=True,
            provider=LLMProvider.OPENAI_LANGCHAIN
        )

        self.synthesis_prompt = """You're creating a natural, spoken response that handles potentially problematic conversations with grace while maintaining helpful conversation flow.

SITUATION AWARENESS:
- You're responding to content that was flagged as needing expert analysis
- Your role is to gracefully redirect while staying helpful and on-topic
- Maintain the conversation plan's progression without getting derailed

RESPONSE STRATEGY:
1. Acknowledge the user's interest without dwelling on problematic aspects
2. Gently redirect to appropriate topics while maintaining conversation flow
3. Use their name and communication preferences when available
4. **CRITICAL: Stay within the current conversation step's purpose - redirect TO the current step's goal**
5. Focus on pending deliverables from the current step rather than making random smalltalk
6. Keep responses brief, natural, and conversational (~30 words target)

STEP-FOCUSED REDIRECTION:
- When redirecting from unsafe content, redirect TOWARD the current step's instruction and deliverables
- Use the current step's purpose as your redirection target (NOT random topics)
- Reference what you're trying to learn/accomplish in the current step
- Avoid generic smalltalk - stay plan-focused even when redirecting

TONE GUIDELINES:
- Sound like a helpful, understanding friend
- Don't be preachy or judgmental
- Use natural speech patterns with conversational connectors
- Include natural pauses with commas for TTS
- **TARGET: ~30 words per response (20-40 word range)**
- Make it sound human and spontaneous, not robotic
- **CRITICAL: Ask only ONE question per message maximum**
- You can make comments and acknowledgments, but limit to ONE focused question if any
- **IMPORTANT: When multiple deliverables are needed, focus on ONE deliverable per turn**
- Choose the most natural deliverable to ask about based on conversation flow

REDIRECTION TECHNIQUES (Always toward current step goals, ONE question max, ~30 words):
- "I understand your interests, [Name], but I'd love to hear about [current step topic] - [one specific question]"
- "That's quite a topic, but let's focus on [current step deliverable] - [brief question]"
- "I get the curiosity, [Name], but I'm really interested in [current step goal] - [focused question]"
- "While I can't dive into that area, I'd love to know about [current step focus] - [one question]"

QUESTION LIMIT EXAMPLES:
✅ GOOD (One question, ~30 words): "I understand your interests, Felix, but I'd love to hear about your hobbies - what do you enjoy doing for fun?"
❌ BAD (Multiple questions): "That's interesting, Felix! What are your hobbies? Do you have any favorites? How long have you been into that?"

CRITICAL OUTPUT ORDER FOR OPTIMAL STREAMING:
When providing your analysis, use this EXACT order:
1. THOUGHT: [Brief reasoning - 1-2 sentences]
2. VERDICT: [This is always an aggregator response, so this is informational only]
3. EXPERTS: [NONE - aggregator doesn't call experts]
4. MESSAGE: [Your ~30 word natural response - THIS STREAMS TO USER IMMEDIATELY]
5. DELIVERABLES: [Any deliverables you can infer - usually NONE for aggregator]
6. STATE_TRANSITION: [READY or NONE - based on plan completion]

Remember: Expert findings help you understand WHY it's problematic, but your response should focus on gentle redirection TOWARD the current conversation step's specific purpose and deliverables - not random topics. Always limit to ONE question maximum per response, and keep it to ~30 words."""

    async def synthesize_streaming(self, user_input: str, expert_findings: List[Dict[str, Any]], input_gate_message: str = "", system_assessments: List[Dict[str, Any]] = None, conversation_context: str = "", enable_voice_narration: bool = True, plan_context: Dict[str, Any] = None) -> AggregatorResult:
        """Synthesize expert findings with streaming output.

        NEW: Processes timekeeper analysis first to detect stuck conversations and apply suggested deliverables.
        """
        start_time = asyncio.get_event_loop().time()

        print(f"[Aggregator] Starting synthesis with {len(expert_findings)} expert findings")

        if not self.llm_service.get_available_providers():
            # No LLM providers available - communicate to frontend
            await self.stream_service.send_system_issue(
                issue_type="aggregator_llm_unavailable",
                issue_description="AI synthesis engine not available",
                severity="error",
                suggested_action="Expert findings cannot be synthesized into final response",
                technical_details="No LLM providers available - check configuration"
            )
            return await self._send_synthesis_error("LLM service not available", expert_findings)

        if not expert_findings:
            # No expert findings to synthesize - communicate to frontend
            await self.stream_service.send_system_issue(
                issue_type="no_expert_findings",
                issue_description="No expert analysis results available for synthesis",
                severity="warning",
                suggested_action="Response will be generated without expert analysis",
                technical_details="All expert agents failed or none were selected"
            )
            return await self._send_synthesis_error("No expert findings to synthesize", expert_findings)

        # NEW: Step 1 - Process timekeeper analysis FIRST (before synthesis)
        timekeeper_analysis = self._process_timekeeper_analysis(expert_findings)
        applied_deliverables = []
        should_force_transition = False

        if timekeeper_analysis:
            recommendation = timekeeper_analysis.get("recommendation", "continue")
            print(f"[Aggregator] Timekeeper recommendation: {recommendation}")

            # Step 1a: Apply suggested deliverables if any
            if timekeeper_analysis.get("suggested_deliverables"):
                applied_deliverables = await self._extract_deliverables_from_timekeeper(
                    timekeeper_analysis, user_input
                )
                if applied_deliverables:
                    print(f"[Aggregator] Applied {len(applied_deliverables)} timekeeper deliverables: {applied_deliverables}")

            # Step 1b: Check if we should force transition
            should_force_transition = self._should_force_transition(timekeeper_analysis)
        else:
            print(f"[Aggregator] No timekeeper analysis available")

        # Generate transcript ID and unique message ID for this aggregator response
        transcript_id = self.stream_service.generate_stream_id()
        message_id = f"agg_{transcript_id}"  # Unique message ID for aggregator responses

        await self.stream_service.send_decision_stream(
            "aggregator_start",
            "Synthesizing expert findings...",
            metadata={
                "component": "aggregator",
                "expert_count": len(expert_findings),
                "message_id": message_id
            }
        )

        # Analyze conflicts and consensus
        conflict_analysis = self._analyze_conflicts(expert_findings)

        # Create streaming callback with message tracking and voice narration preference
        callback = StreamingAggregatorCallback(
            self.stream_service,
            transcript_id,
            self.tts_service if enable_voice_narration else None,  # Pass TTS only if voice narration is enabled
            message_id=message_id
        )

        # Prepare synthesis input with system assessments, timekeeper analysis, and force transition flag
        synthesis_input = self._build_synthesis_prompt(
            user_input=user_input,
            expert_findings=expert_findings,
            conflict_analysis=conflict_analysis,
            input_gate_message=input_gate_message,
            system_assessments=system_assessments or [],
            conversation_context=conversation_context,
            plan_context=plan_context or {},
            timekeeper_analysis=timekeeper_analysis,
            should_force_transition=should_force_transition
        )

        try:
            # Prepare messages for LLM service
            messages = [
                LLMMessage(role="system", content=self.synthesis_prompt),
                LLMMessage(role="user", content=synthesis_input)
            ]

            # Use LLM service for streaming synthesis
            llm_response = await self.llm_service.generate(
                messages=messages,
                config=self.config,
                callback=callback,
                component_name="aggregator"
            )

            response = llm_response.content

            # Determine step management based on expert analysis
            step_analysis = None
            if self.task_manager:
                step_analysis = self.task_manager.determine_next_step_based_on_analysis(
                    user_input, expert_findings, conversation_context
                )
                # Update task manager based on analysis
                await self._update_task_manager_based_on_analysis(step_analysis, expert_findings, user_input)

            # Send final transcript chunk
            await self.stream_service.send_transcript_chunk(
                text=response,
                is_final=True,
                transcript_id=transcript_id,
                confidence=0.8
            )

            # Calculate confidence score
            confidence_score = self._calculate_confidence(expert_findings, conflict_analysis)

            end_time = asyncio.get_event_loop().time()
            processing_time = int((end_time - start_time) * 1000)

            await self.stream_service.send_decision_stream(
                "aggregator_complete",
                "Synthesis complete",
                confidence=confidence_score,
                timing_ms=processing_time,
                metadata={
                    "conflicts": len(conflict_analysis["conflicts"]),
                    "response_length": len(response)
                }
            )

            return AggregatorResult(
                consolidated_response=response,
                confidence_score=confidence_score,
                conflicting_findings=conflict_analysis["conflicts"],
                transcript_id=transcript_id,
                processing_time_ms=processing_time
            )

        except Exception as e:
            print(f"[Aggregator] Synthesis failed: {e}")
            return await self._send_synthesis_error(str(e), expert_findings)

    def _analyze_conflicts(self, expert_findings: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze conflicts and consensus among expert findings."""
        conflicts = []
        consensus = []

        if len(expert_findings) < 2:
            return {
                "conflicts": [],
                "consensus": [],
                "successful_experts": len([f for f in expert_findings if f.get("success")]),
                "failed_experts": len([f for f in expert_findings if not f.get("success")])
            }

        # Check for conflicting risk assessments
        high_risk_experts = [f for f in expert_findings if f.get("risks") and len(f["risks"]) > 0]
        low_risk_experts = [f for f in expert_findings if not f.get("risks") or len(f["risks"]) == 0]

        if high_risk_experts and low_risk_experts:
            high_risk_names = [f["agent_name"] for f in high_risk_experts]
            low_risk_names = [f["agent_name"] for f in low_risk_experts]
            conflicts.append(
                f"Risk assessment disagreement: {', '.join(high_risk_names)} identified risks "
                f"while {', '.join(low_risk_names)} found no significant risks"
            )

        # Check for conflicting recommendations
        recommendations = [f.get("recommendation", "none") for f in expert_findings if f.get("success")]
        unique_recommendations = list(set(recommendations))

        if len(unique_recommendations) > 2:
            conflicts.append(f"Multiple recommendations: {', '.join(unique_recommendations)}")

        # Find consensus (common themes)
        all_findings = [f.get("findings", "").lower() for f in expert_findings if f.get("success")]
        common_keywords = ["safe", "proceed", "caution", "recommend", "avoid"]

        for keyword in common_keywords:
            mentions = [text for text in all_findings if keyword in text]
            if len(mentions) >= len(expert_findings) // 2:
                consensus.append(f"Multiple experts mention: {keyword}")

        return {
            "conflicts": conflicts,
            "consensus": consensus,
            "successful_experts": len([f for f in expert_findings if f.get("success")]),
            "failed_experts": len([f for f in expert_findings if not f.get("success")])
        }

    def _calculate_confidence(self, expert_findings: List[Dict[str, Any]], conflict_analysis: Dict[str, Any]) -> float:
        """Calculate overall confidence based on expert consensus."""
        if not expert_findings:
            return 0.0

        successful_findings = [f for f in expert_findings if f.get("success")]
        if not successful_findings:
            return 0.1

        # Average confidence of successful experts
        avg_confidence = sum(f.get("confidence", 0.5) for f in successful_findings) / len(successful_findings)

        # Penalty for conflicts
        conflict_penalty = min(0.3, len(conflict_analysis["conflicts"]) * 0.1)

        # Penalty for failed experts
        failure_rate = conflict_analysis["failed_experts"] / len(expert_findings)
        failure_penalty = failure_rate * 0.2

        final_confidence = max(0.0, min(1.0, avg_confidence - conflict_penalty - failure_penalty))
        return round(final_confidence, 2)

    def _process_timekeeper_analysis(self, expert_findings: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """Extract and process timekeeper expert results.

        Returns timekeeper analysis dict or None if timekeeper didn't run.
        """
        for finding in expert_findings:
            if finding.get("agent_name") == "timekeeper" and finding.get("success"):
                print(f"[Aggregator] Processing timekeeper analysis")
                return self._parse_timekeeper_findings(finding)

        return None

    def _parse_timekeeper_findings(self, timekeeper_result: Dict[str, Any]) -> Dict[str, Any]:
        """Parse timekeeper's structured output from findings.

        Timekeeper provides:
        - TURNS_WITHOUT_DELIVERABLES
        - IS_STUCK
        - MODE
        - FINDINGS
        - SUGGESTED_DELIVERABLES (JSON)
        - RECOMMENDATION (continue/update_tasks/force_transition)
        - REASONING
        """
        findings_text = timekeeper_result.get("findings", "")

        # Extract structured fields using regex
        turns_match = re.search(r'TURNS_WITHOUT_DELIVERABLES:\s*(\d+)', findings_text)
        stuck_match = re.search(r'IS_STUCK:\s*(true|false)', findings_text, re.IGNORECASE)
        mode_match = re.search(r'MODE:\s*(strict|loose)', findings_text, re.IGNORECASE)
        recommendation_match = re.search(r'RECOMMENDATION:\s*(continue|update_tasks|force_transition)', findings_text, re.IGNORECASE)

        # Extract suggested deliverables JSON
        suggested_deliverables = {}
        deliverables_match = re.search(r'SUGGESTED_DELIVERABLES:\s*(\{[^}]+\}|\[NONE\])', findings_text, re.DOTALL)
        if deliverables_match:
            deliverables_str = deliverables_match.group(1).strip()
            if deliverables_str != "[NONE]":
                try:
                    suggested_deliverables = json.loads(deliverables_str)
                except json.JSONDecodeError as e:
                    print(f"[Aggregator] Failed to parse timekeeper deliverables: {e}")

        parsed = {
            "turns_without_deliverables": int(turns_match.group(1)) if turns_match else 0,
            "is_stuck": stuck_match.group(1).lower() == "true" if stuck_match else False,
            "mode": mode_match.group(1).lower() if mode_match else "unknown",
            "recommendation": recommendation_match.group(1).lower() if recommendation_match else "continue",
            "suggested_deliverables": suggested_deliverables,
            "raw_findings": findings_text
        }

        print(f"[Aggregator] Timekeeper analysis: {parsed['recommendation']} (turns: {parsed['turns_without_deliverables']}, stuck: {parsed['is_stuck']})")
        return parsed

    async def _extract_deliverables_from_timekeeper(self, timekeeper_analysis: Dict[str, Any], user_input: str) -> List[str]:
        """Extract and apply deliverables suggested by timekeeper.

        Returns list of deliverable keys that were successfully applied.
        """
        suggested_deliverables = timekeeper_analysis.get("suggested_deliverables", {})
        if not suggested_deliverables:
            return []

        applied_deliverables = []

        for key, deliverable_data in suggested_deliverables.items():
            try:
                if isinstance(deliverable_data, dict):
                    value = deliverable_data.get('value')
                    reasoning = deliverable_data.get('reasoning', 'Inferred by timekeeper from context')
                else:
                    value = deliverable_data
                    reasoning = 'Inferred by timekeeper from context'

                # Apply to task manager if available
                if self.task_manager:
                    # Check if in state machine mode
                    if self.task_manager.is_state_machine_mode():
                        state_machine = self.task_manager.state_machine
                        if state_machine and key in state_machine.execution_state.deliverable_states:
                            await state_machine.execution_state.set_deliverable_value(
                                key, value, user_input, confidence=0.85, reasoning=f"[Timekeeper] {reasoning}"
                            )
                            applied_deliverables.append(key)
                            print(f"[Aggregator] Applied timekeeper deliverable: {key} = {value}")
                    # Legacy mode
                    elif self.task_manager.is_legacy_mode() and self.task_manager.plan_execution:
                        await self.task_manager.plan_execution.set_deliverable_value(
                            key, value, user_input, confidence=0.85, reasoning=f"[Timekeeper] {reasoning}"
                        )
                        applied_deliverables.append(key)
                        print(f"[Aggregator] Applied timekeeper deliverable (legacy): {key} = {value}")

            except Exception as e:
                print(f"[Aggregator] Failed to apply timekeeper deliverable {key}: {e}")

        return applied_deliverables

    def _should_force_transition(self, timekeeper_analysis: Dict[str, Any]) -> bool:
        """Determine if state transition should be forced based on timekeeper analysis.

        Force transition when:
        - Recommendation is 'force_transition'
        - Mode is strict
        - 2+ turns without progress
        """
        if not timekeeper_analysis:
            return False

        recommendation = timekeeper_analysis.get("recommendation", "continue")
        mode = timekeeper_analysis.get("mode", "unknown")
        turns = timekeeper_analysis.get("turns_without_deliverables", 0)
        is_stuck = timekeeper_analysis.get("is_stuck", False)

        should_force = (
            recommendation == "force_transition" and
            mode == "strict" and
            turns >= 2 and
            is_stuck
        )

        if should_force:
            print(f"[Aggregator] Timekeeper recommends FORCE TRANSITION (mode: {mode}, turns: {turns}, stuck: {is_stuck})")

        return should_force

    def _build_synthesis_prompt(self, user_input: str, expert_findings: List[Dict[str, Any]], conflict_analysis: Dict[str, Any], input_gate_message: str = "", system_assessments: List[Dict[str, Any]] = None, conversation_context: str = "", plan_context: Dict[str, Any] = None, timekeeper_analysis: Dict[str, Any] = None, should_force_transition: bool = False) -> str:
        """Build the synthesis prompt with expert findings.

        NEW: Includes timekeeper analysis and force transition guidance.
        """
        # Format expert findings (both successful and failed)
        successful_experts = []
        failed_experts = []

        for finding in expert_findings:
            if finding.get("success"):
                summary = f"**{finding['agent_name']}** (confidence: {finding.get('confidence', 0.5):.1f}):\n"
                summary += f"Findings: {finding.get('findings', 'No findings')}\n"
                summary += f"Risks: {', '.join(finding.get('risks', [])) or 'None identified'}\n"
                summary += f"Recommendation: {finding.get('recommendation', 'None')}"
                successful_experts.append(summary)
            else:
                failed_summary = f"**{finding['agent_name']}** (FAILED):\n"
                failed_summary += f"Error: {finding.get('findings', 'Unknown error')}\n"
                failed_summary += f"Status: Unable to provide analysis"
                failed_experts.append(failed_summary)

        # Combine successful and failed expert information
        expert_sections = []
        if successful_experts:
            expert_sections.append("Successful Expert Analysis:\n" + "\n\n".join(successful_experts))
        if failed_experts:
            expert_sections.append("Failed Expert Analysis:\n" + "\n\n".join(failed_experts))

        expert_text = "\n\n".join(expert_sections)

        # Add conflict information if any
        conflict_text = ""
        if conflict_analysis["conflicts"]:
            conflict_text = f"\n\nConflicts identified:\n" + "\n".join(conflict_analysis["conflicts"])

        # Add input gate message for seamless continuation
        gate_context = ""
        if input_gate_message:
            gate_context = f"\n\nPrevious message to user: \"{input_gate_message}\"\nContinue seamlessly from this message - don't repeat it, build upon it naturally."

        # Process system assessments and recommendations
        system_guidance = ""
        confidence_adjustments = []
        communication_strategies = []

        if system_assessments:
            assessment_summaries = []
            for assessment in system_assessments:
                data = assessment.get('data', {})
                assessment_summaries.append(f"- {data.get('situation_assessment', 'No assessment')}")

                # Collect aggregator recommendations
                recommendations = data.get('aggregator_recommendations', {})
                for rec_type, rec_value in recommendations.items():
                    if 'confidence' in rec_type:
                        confidence_adjustments.append(rec_value)

                # Collect communication strategies
                strategy = data.get('user_communication_strategy', '')
                if strategy:
                    communication_strategies.append(strategy)

            if assessment_summaries:
                system_guidance = f"\n\nSystem Assessments:\n" + "\n".join(assessment_summaries)

            if communication_strategies:
                system_guidance += f"\n\nCommunication Guidance:\n" + "\n".join(f"- {strategy}" for strategy in communication_strategies)

        conversation_section = ""
        if conversation_context:
            conversation_section = f"\n\nConversation History:\n{conversation_context}\n"

        # Add plan context section
        plan_section = ""
        if plan_context:
            current_step = plan_context.get("current_step", {})
            next_task = plan_context.get("next_task")
            next_state = plan_context.get("next_state")
            processing_mode = plan_context.get("processing_mode", "unknown")
            user_info = plan_context.get("user_info", {})
            remaining_steps = plan_context.get("remaining_steps", [])
            all_deliverable_states = plan_context.get("all_deliverable_states", {})
            progress = plan_context.get("progress", {})

            plan_section = f"\n\nCONVERSATION PLAN CONTEXT:\n"
            plan_section += f"- This conversation was flagged as problematic and requires expert mitigation\n"
            plan_section += f"- **CRITICAL**: Your role is to redirect TOWARD the current step's specific purpose, NOT random topics\n"
            plan_section += f"- When redirecting from unsafe content, use the current step instruction as your target\n"
            plan_section += f"- Processing mode: {processing_mode.upper()}\n"

            # Add progress information
            if progress:
                plan_section += f"- Progress: {progress.get('percentage', 0):.1f}% complete (step {progress.get('current_step_index', 0) + 1})\n"

            if current_step:
                plan_section += f"- Current step: {current_step.get('title', 'Unknown')}\n"
                plan_section += f"- Step purpose: {current_step.get('instruction', 'Continue conversation naturally')}\n"

                # Add deliverable information with collection status
                deliverables = current_step.get('deliverables', [])
                if deliverables:
                    plan_section += f"- Current step deliverables:\n"
                    for deliverable in deliverables:
                        deliverable_key = deliverable.get('key')
                        status = deliverable.get('status', 'pending')
                        value = None

                        # Check if this deliverable has been collected
                        current_step_id = current_step.get('id')
                        if current_step_id and current_step_id in all_deliverable_states:
                            step_deliverables = all_deliverable_states[current_step_id].get('deliverables', {})
                            if deliverable_key in step_deliverables:
                                deliverable_state = step_deliverables[deliverable_key]
                                status = deliverable_state.get('status', 'pending')
                                value = deliverable_state.get('value')

                        # Status indicator
                        if status == 'completed':
                            status_text = f" [STATUS: COMPLETED (value: {value}) - can be updated if new evidence]"
                        elif status == 'skipped':
                            status_text = f" [STATUS: SKIPPED]"
                        else:
                            status_text = f" [STATUS: PENDING - needs collection]"

                        plan_section += f"  * {deliverable['description']}"
                        if deliverable.get('required'):
                            plan_section += " (required)"
                        plan_section += f"{status_text}\n"

                        # Add acceptance criteria if available
                        if deliverable.get('acceptance_criteria'):
                            plan_section += f"    Criteria: {deliverable['acceptance_criteria']}\n"

                        # Only add examples for PENDING deliverables (not completed/skipped)
                        if status == 'pending' and deliverable.get('examples'):
                            examples_str = ", ".join(deliverable['examples'])
                            plan_section += f"    Examples: {examples_str}\n"

                # Add next task for strict mode (transition preparation)
                if next_task and processing_mode == "strict":
                    plan_section += f"\n- NEXT TASK (upcoming - for transition preparation):\n"
                    plan_section += f"  * Task: {next_task.get('description', 'Unknown')}\n"
                    plan_section += f"  * Purpose: {next_task.get('instruction', 'Continue naturally')}\n"

                    next_deliverables = next_task.get('deliverables', [])
                    if next_deliverables:
                        plan_section += f"  * Upcoming deliverables:\n"
                        for d in next_deliverables:
                            req_text = " (required)" if d.get('required') else " (optional)"
                            plan_section += f"    - {d.get('description', '')}{req_text}\n"

            # Add next state transition information (for both loose and strict modes)
            if next_state:
                plan_section += f"\n- STATE TRANSITION INFORMATION:\n"
                plan_section += f"  * When current state completes, you'll advance to: {next_state.get('title', 'Unknown')}\n"
                plan_section += f"  * Next state type: {next_state.get('type', 'unknown')}\n"
                plan_section += f"  * Next state purpose: {next_state.get('description', '')}\n"

                # Show preview of upcoming tasks
                preview_tasks = next_state.get('preview_tasks', [])
                if preview_tasks:
                    plan_section += f"  * Upcoming activities in next state:\n"
                    for i, preview_task in enumerate(preview_tasks[:2], 1):
                        plan_section += f"    {i}. {preview_task.get('description', 'Unknown')}\n"

                # Calculate and show completion urgency for loose mode
                if processing_mode == "loose" and current_step:
                    # Count pending deliverables in current state
                    deliverables = current_step.get('deliverables', [])
                    pending_count = sum(1 for d in deliverables if d.get('status') == 'pending')

                    if pending_count > 0 and pending_count <= 2:
                        plan_section += f"  * ⚡ URGENCY: Only {pending_count} deliverable(s) remaining to advance to next state!\n"
                        plan_section += f"  * FOCUS: Prioritize collecting remaining deliverables to enable state transition\n"

            if user_info:
                name = user_info.get('user_name')
                style = user_info.get('communication_style')
                if name:
                    plan_section += f"- User's name: {name}\n"
                if style:
                    plan_section += f"- User's preferred communication style: {style}\n"

            # Add remaining steps information for context
            if remaining_steps:
                plan_section += f"\n- UPCOMING STEPS (next 3):\n"
                for idx, step in enumerate(remaining_steps[:3], 1):
                    plan_section += f"  {idx}. {step.get('title', 'Unknown')} ({step.get('type', 'Unknown')})\n"
                    step_deliverables = step.get('deliverables', [])
                    if step_deliverables:
                        for d in step_deliverables:
                            req_text = "required" if d.get('required') else "optional"
                            plan_section += f"     - {d.get('key', 'unknown')}: {d.get('description', 'unknown')} ({req_text})\n"

                if len(remaining_steps) > 3:
                    plan_section += f"  ... and {len(remaining_steps) - 3} more steps\n"

            # Add deliverable collection summary
            if all_deliverable_states:
                completed_deliverables = []
                pending_deliverables = []

                for step_id, step_data in all_deliverable_states.items():
                    step_title = step_data.get('step_title', step_id)
                    for key, deliverable in step_data.get('deliverables', {}).items():
                        if deliverable.get('status') == 'completed':
                            completed_deliverables.append(f"{key} ({step_title})")
                        elif deliverable.get('required'):
                            pending_deliverables.append(f"{key} ({step_title})")

                if completed_deliverables:
                    plan_section += f"\n- COLLECTED INFORMATION: {', '.join(completed_deliverables)}\n"
                if pending_deliverables:
                    plan_section += f"- STILL NEEDED: {', '.join(pending_deliverables)}\n"

            plan_section += f"\n- RESPONSE STRATEGY FOR REDIRECTION:\n"
            plan_section += f"  * Acknowledge their interest but redirect SPECIFICALLY to the current step's purpose\n"
            plan_section += f"  * Use the current step instruction as your redirection target (shown above)\n"
            plan_section += f"  * Focus on completing the current step's pending deliverables\n"
            plan_section += f"  * Ask questions that advance the current step rather than making random smalltalk\n"
            plan_section += f"  * Use collected user information to personalize the current step's questions\n"

        # NEW: Add timekeeper analysis section
        timekeeper_section = ""
        if timekeeper_analysis:
            timekeeper_section = f"\n\n🕐 TIMEKEEPER ANALYSIS (Conversation Progress Monitor):\n"
            timekeeper_section += f"- Recommendation: {timekeeper_analysis.get('recommendation', 'continue').upper()}\n"
            timekeeper_section += f"- Turns without deliverables: {timekeeper_analysis.get('turns_without_deliverables', 0)}\n"
            timekeeper_section += f"- Conversation stuck: {'YES' if timekeeper_analysis.get('is_stuck') else 'NO'}\n"
            timekeeper_section += f"- Mode: {timekeeper_analysis.get('mode', 'unknown').upper()}\n"

            if should_force_transition:
                timekeeper_section += f"\n⚠️  FORCE TRANSITION REQUIRED:\n"
                timekeeper_section += f"- The timekeeper has determined this conversation is stuck\n"
                timekeeper_section += f"- In STRICT mode with 2+ turns without required deliverables\n"
                timekeeper_section += f"- **ACTION REQUIRED**: Acknowledge what's been learned and gracefully transition\n"
                timekeeper_section += f"- **SET STATE_TRANSITION: ['READY'] in your response**\n"
                timekeeper_section += f"- Keep your response brief (~30 words) and natural\n"

            suggested_deliverables = timekeeper_analysis.get('suggested_deliverables', {})
            if suggested_deliverables:
                timekeeper_section += f"\nSuggested deliverables (already applied):\n"
                for key, deliverable in suggested_deliverables.items():
                    if isinstance(deliverable, dict):
                        value = deliverable.get('value')
                        reasoning = deliverable.get('reasoning')
                        timekeeper_section += f"  * {key} = {value} ({reasoning})\n"
                    else:
                        timekeeper_section += f"  * {key} = {deliverable}\n"

        return f"""User Query: "{user_input}"{conversation_section}{plan_section}{timekeeper_section}

Expert Analysis Results:
{expert_text}{conflict_text}{gate_context}{system_guidance}

CRITICAL INSTRUCTIONS FOR CONVERSATION CONTINUITY:
- Pay special attention to [MOST RECENT] and [RECENT] messages in the conversation history
- If you've already addressed similar topics in recent messages, acknowledge this and build upon previous responses rather than repeating them
- Reference specific previous advice or recommendations when relevant to show continuity
- Avoid giving the same guidance you've already provided - instead, refine, expand, or offer different perspectives
- If the user is asking follow-up questions, connect your response to the earlier discussion

Please synthesize this information into a helpful, natural response that:
1. **PRIORITY: Redirects toward the current step's specific purpose and deliverables (NOT random topics)**
2. Uses the current step instruction as the primary redirection target when handling unsafe content
3. Directly addresses the user's question while steering toward current step goals
4. Incorporates relevant expert insights from successful experts while avoiding repetition of recent advice
5. Follows the communication strategies provided in system assessments
6. Adjusts confidence appropriately based on system limitations ({', '.join(confidence_adjustments) if confidence_adjustments else 'normal confidence'})
7. Acknowledges any failed experts and system limitations transparently
8. Maintains strong conversation continuity by referencing and building upon recent context
9. Acknowledges any uncertainties or disagreements naturally
10. Provides actionable guidance that advances the current step rather than making smalltalk
11. Sounds conversational and human with natural flow from previous messages
12. If there was a previous message to the user, continue seamlessly from it without repetition

IMPORTANT:
- Follow the specific communication strategies from system assessments
- Be transparent about system limitations but maintain helpfulness
- Use the recommended response tone and disclosure level from assessments
- If experts failed or systems are degraded, explain this naturally while still being as helpful as possible
- NEVER repeat the same advice given in recent messages - always add new value or perspectives

**CRITICAL - STEP-FOCUSED REDIRECTION REQUIREMENTS:**
- When content is flagged as unsafe, you MUST redirect TO the current step's purpose, not away from it
- Use the current step instruction (shown in plan context) as your redirection target
- Reference the current step's pending deliverables to guide your response
- Avoid generic smalltalk topics that don't advance the conversation plan
- Example: If current step is about hobbies, redirect unsafe content toward asking about hobbies"""

    async def _send_synthesis_error(self, error_message: str, expert_findings: List[Dict[str, Any]]) -> AggregatorResult:
        """Send error message when synthesis fails."""
        transcript_id = self.stream_service.generate_stream_id()

        # Send error via decision stream
        await self.stream_service.send_decision_stream(
            "aggregation_error",
            f"Expert synthesis failed: {error_message}",
            confidence=0.0,
            metadata={
                "error_type": "aggregation_failure",
                "error_details": error_message,
                "expert_count": len(expert_findings),
                "successful_experts": len([f for f in expert_findings if f.get("success")])
            }
        )

        # Don't send any transcript response - let the error handling in processor take care of it
        return AggregatorResult(
            consolidated_response="",
            confidence_score=0.0,
            conflicting_findings=[],
            transcript_id=transcript_id,
            processing_time_ms=0
        )

    async def _update_task_manager_based_on_analysis(self, step_analysis: Dict[str, Any], expert_findings: List[Dict[str, Any]], user_input: str):
        """Update the task manager based on step analysis from expert findings."""
        if not self.task_manager or not step_analysis:
            return

        action = step_analysis.get("action", "continue")
        current_step_id = step_analysis.get("current_step_id")

        try:
            # Add expert findings to current step
            self.task_manager.add_expert_findings_to_current_step(expert_findings)

            # Handle different actions
            if action == "advance":
                # Complete current step and advance to next
                if step_analysis.get("step_status_update"):
                    self.task_manager.update_current_step(step_analysis["step_status_update"])

                success = self.task_manager.advance_to_next_step()
                if success:
                    await self._send_task_progress_update("step_advanced", {
                        "previous_step": current_step_id,
                        "current_step": self.task_manager.get_current_step().id if self.task_manager.get_current_step() else None
                    })

            elif action == "complete":
                # Complete the conversation
                if step_analysis.get("step_status_update"):
                    self.task_manager.update_current_step(step_analysis["step_status_update"])

                await self._send_task_progress_update("conversation_completed", {
                    "final_step": current_step_id
                })

            elif action == "continue":
                # Stay on current step but possibly update status or add tasks
                if step_analysis.get("step_status_update"):
                    self.task_manager.update_current_step(step_analysis["step_status_update"])

            # Create any suggested tasks
            for task_desc in step_analysis.get("tasks_to_create", []):
                task_id = f"task_{len(self.task_manager.get_current_step().tasks) + 1}"
                self.task_manager.add_task_to_current_step(task_id, task_desc, user_input)

            # Send overall progress update
            await self._send_task_progress_update("task_manager_updated", step_analysis.get("metadata", {}))

        except Exception as e:
            print(f"[Aggregator] Error updating task manager: {e}")

    async def _send_task_progress_update(self, update_type: str, metadata: Dict[str, Any]):
        """Send task progress update to frontend."""
        if not self.task_manager:
            return

        progress_summary = self.task_manager.get_progress_summary()

        await self.stream_service.send_task_progress_update(
            update_type=update_type,
            current_step=progress_summary["current_step"],
            progress=progress_summary["progress"],
            tasks=progress_summary["tasks"],
            steps=progress_summary["steps"],
            metadata={
                **metadata,
                "component": "aggregator",
                "note": "complete_todo_list_sent_by_message_processor_after_turn"
            }
        )

        # For significant changes, also send complete todo list update immediately
        significant_changes = ["step_advanced", "conversation_completed", "task_created", "expert_analysis_completed"]
        if update_type in significant_changes:
            complete_todo_list = self.task_manager.get_complete_todo_list()
            await self.stream_service.send_complete_todo_list(
                todo_list_data=complete_todo_list,
                update_trigger=f"aggregator_{update_type}"
            )
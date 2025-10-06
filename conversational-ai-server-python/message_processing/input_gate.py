"""
Streaming Input Gate that makes routing decisions while streaming responses.
Uses [SAFE] and [COMPLEX] decision markers to route messages appropriately.
"""
import asyncio
import re
import json
from typing import Dict, Any, Optional, Tuple, List
from dataclasses import dataclass

from .stream_service import StreamService
from .llm_service import LLMService, LLMConfig, LLMProvider, LLMStreamingCallback, LLMMessage, LLMResponse
from .prompt_components import PromptBuilder


@dataclass
class GateResult:
    """Result from input gate processing."""
    verdict: str  # "safe" or "unsafe"
    route: str  # "SAFE" or "COMPLEX"
    response: str
    expert_configuration: Optional[Dict[str, Any]]  # Configuration for which experts to fire up
    intent: str
    risk_score: float
    confidence: float
    transcript_id: str
    needs_expert_analysis: bool


class StreamingInputGateCallback(LLMStreamingCallback):
    """Custom callback for streaming input gate responses."""

    def __init__(self, stream_service: StreamService, transcript_id: str, tts_service=None, message_id: str = None):
        self.stream_service = stream_service
        self.transcript_id = transcript_id
        self.tts_service = tts_service
        self.accumulated_text = ""
        self.thought_detected = False
        self.thought = None
        self.verdict_detected = False
        self.verdict = None
        self.experts = None
        self.state_transition = None
        self.message_started = False
        self.last_streamed_message = ""
        self.message_id = message_id or transcript_id  # Use transcript_id as fallback message_id
        self.tts_ended = False  # Track if we've hit structural markers and should stop TTS

    async def on_token(self, token: str, accumulated_text: str) -> None:
        """Handle each new token from the LLM.

        NEW OPTIMAL PARSING ORDER for parallel execution:
        1. THOUGHT - Quick reasoning
        2. VERDICT - Parse immediately to trigger expert pool
        3. EXPERTS - Parse immediately for parallel execution
        4. MESSAGE - Stream to user ASAP while experts run
        5. DELIVERABLES - Parse during message streaming
        6. STATE_TRANSITION - Final decision
        """
        self.accumulated_text = accumulated_text

        # 1. Check for THOUGHT (first field)
        if not self.thought_detected:
            thought_match = re.search(r'THOUGHT: (.+?)(?=VERDICT:|$)', self.accumulated_text, re.DOTALL)
            if thought_match:
                self.thought = thought_match.group(1).strip()
                self.thought_detected = True

        # 2. Check for VERDICT (critical - parsed immediately to trigger expert pool)
        if not self.verdict_detected:
            if "VERDICT: [SAFE]" in self.accumulated_text:
                self.verdict = "safe"
                self.verdict_detected = True
            elif "VERDICT: [UNSAFE]" in self.accumulated_text:
                self.verdict = "unsafe"
                self.verdict_detected = True

        # 3. Check for EXPERTS configuration (critical - parsed immediately for parallel execution)
        if self.verdict_detected and self.experts is None:
            experts_match = re.search(r'EXPERTS: \[([^\]]+)\]', self.accumulated_text)
            if experts_match:
                experts_str = experts_match.group(1)
                if experts_str.upper() == "NONE":
                    self.experts = []
                else:
                    self.experts = [e.strip() for e in experts_str.split(',')]

        # 4. Stream MESSAGE content (streams to user while experts run in parallel)
        message_match = re.search(r'MESSAGE: (.+?)(?=DELIVERABLES:|STATE_TRANSITION:|$)', self.accumulated_text, re.DOTALL)
        if message_match and not self.message_started:
            self.message_started = True

        # Stream the clean message content immediately
        if self.message_started and message_match:
            clean_message = message_match.group(1).strip()
            if clean_message and clean_message != self.last_streamed_message:
                # Send to frontend for display
                await self.stream_service.send_transcript_chunk(
                    text=clean_message,
                    is_final=False,
                    transcript_id=self.transcript_id,
                    confidence=0.8
                )

                # Send incremental text to TTS for sentence processing with message tracking
                if self.tts_service and not self.tts_ended and len(clean_message) > len(self.last_streamed_message):
                    new_text_chunk = clean_message[len(self.last_streamed_message):]

                    # Check if this chunk contains structural markers (DELIVERABLES or STATE_TRANSITION)
                    # If so, truncate before the marker and mark as final TTS sentence
                    truncated_chunk = new_text_chunk
                    for marker in ['DELIVERABLES:', 'STATE_TRANSITION:']:
                        if marker in new_text_chunk:
                            # Cut off everything from the marker onwards
                            marker_pos = new_text_chunk.find(marker)
                            truncated_chunk = new_text_chunk[:marker_pos].strip()
                            self.tts_ended = True
                            print(f"[InputGate] Detected {marker} in TTS chunk - truncating and ending TTS")
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

                self.last_streamed_message = clean_message

        # 5. DELIVERABLES parsed in background (during message streaming) - handled in get_parsed_content()

        # 6. Check for STATE_TRANSITION (final decision)
        if self.state_transition is None:
            state_transition_match = re.search(r'STATE_TRANSITION: \[([^\]]+)\]', self.accumulated_text)
            if state_transition_match:
                transition_str = state_transition_match.group(1).strip()
                if transition_str.upper() == "NONE":
                    self.state_transition = None
                elif transition_str == '"READY"' or transition_str == 'READY':
                    self.state_transition = "READY"
                else:
                    self.state_transition = transition_str

    async def on_complete(self, final_response: LLMResponse) -> None:
        """Called when streaming is complete."""
        # Clear any remaining buffer (would only contain structural keywords at this point)
        if self.tts_service:
            await self.tts_service.clear_buffer()

    async def on_error(self, error: Exception) -> None:
        """Called when an error occurs."""
        print(f"[InputGate] Streaming error: {error}")

    def get_parsed_content(self) -> tuple:
        """Extract thought, verdict, experts, deliverables, state_transition, and message from accumulated text."""
        thought = self.thought or ""
        verdict = self.verdict or "unsafe"  # Default to unsafe for safety
        experts = self.experts or []
        state_transition = self.state_transition

        # Comprehensive debug logging
        print(f"\n🔍 [InputGate] COMPLETE LLM RESPONSE ANALYSIS:")
        print(f"🔍 [InputGate] Full accumulated text length: {len(self.accumulated_text)} chars")
        print(f"🔍 [InputGate] Full accumulated text:\n{'-'*50}")
        print(self.accumulated_text)
        print(f"{'-'*50}")

        # Extract deliverables JSON with robust parsing
        deliverables = {}
        deliverables_str = self._extract_deliverables_json(self.accumulated_text)

        if deliverables_str:
            print(f"🔍 [InputGate] Extracted deliverables string: '{deliverables_str}'")
            if deliverables_str != "[NONE]":
                deliverables = self._parse_deliverables_json(deliverables_str)
            else:
                print(f"🔍 [InputGate] Deliverables explicitly set to [NONE]")
        else:
            print(f"🔍 [InputGate] No deliverables section found in response")

        # Extract MESSAGE (comes after EXPERTS, before DELIVERABLES in new order)
        message_match = re.search(r'MESSAGE: (.+?)(?=DELIVERABLES:|STATE_TRANSITION:|$)', self.accumulated_text, re.DOTALL)
        message = message_match.group(1).strip() if message_match else ""

        print(f"🔍 [InputGate] Final parsing results:")
        print(f"🔍 [InputGate] - Thought: {thought[:100] if thought else 'None'}...")
        print(f"🔍 [InputGate] - Verdict: {verdict}")
        print(f"🔍 [InputGate] - Experts: {experts}")
        print(f"🔍 [InputGate] - Deliverables: {deliverables}")
        print(f"🔍 [InputGate] - State Transition: {state_transition}")
        print(f"🔍 [InputGate] - Message length: {len(message)} chars")

        return thought, verdict, experts, deliverables, state_transition, message

    def _extract_deliverables_json(self, text: str) -> Optional[str]:
        """Extract deliverables JSON using robust parsing strategies.

        NOTE: With new optimal ordering, DELIVERABLES comes AFTER MESSAGE.
        This method must handle MESSAGE content before DELIVERABLES.
        """
        # Strategy 1: Look for DELIVERABLES: followed by balanced braces
        deliverables_start = text.find('DELIVERABLES: ')
        if deliverables_start == -1:
            return None

        start_pos = deliverables_start + len('DELIVERABLES: ')
        remaining_text = text[start_pos:]

        # Check for [NONE] first
        if remaining_text.startswith('[NONE]'):
            return '[NONE]'

        # Strategy 2: Find balanced JSON braces (stop at STATE_TRANSITION or end)
        # This ensures we don't accidentally include STATE_TRANSITION content
        if remaining_text.startswith('{'):
            brace_count = 0
            in_string = False
            escape_next = False
            end_pos = 0

            for i, char in enumerate(remaining_text):
                if escape_next:
                    escape_next = False
                    continue

                if char == '\\' and in_string:
                    escape_next = True
                    continue

                if char == '"' and not escape_next:
                    in_string = not in_string
                    continue

                if not in_string:
                    if char == '{':
                        brace_count += 1
                    elif char == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            end_pos = i + 1
                            break

            if end_pos > 0:
                json_str = remaining_text[:end_pos]
                print(f"🔍 [InputGate] Balanced brace extraction found: '{json_str}'")
                return json_str

        # Strategy 3: Fallback regex - match until STATE_TRANSITION or end
        simple_match = re.search(r'DELIVERABLES: (\{.*?\})(?=\s*STATE_TRANSITION:|$)', text, re.DOTALL)
        if simple_match:
            result = simple_match.group(1)
            print(f"🔍 [InputGate] Fallback regex extraction found: '{result}'")
            return result

        print(f"🔍 [InputGate] No valid JSON structure found after DELIVERABLES:")
        return None

    def _parse_deliverables_json(self, json_str: str) -> Dict[str, Any]:
        """Parse deliverables JSON with error handling and fallback strategies."""
        try:
            if not json_str or json_str.strip() == "":
                print(f"❌ [InputGate] Empty JSON string provided")
                return {}

            # Clean up the JSON string to handle malformed quotes
            cleaned_json = json_str.strip()
            print(f"🔧 [InputGate] Attempting to parse JSON: '{cleaned_json}'")

            # Strategy 1: Direct JSON parsing
            try:
                result = json.loads(cleaned_json)
                print(f"✅ [InputGate] Successfully parsed JSON: {result}")
                return result
            except json.JSONDecodeError as e:
                print(f"❌ [InputGate] JSON decode error: {e}")
                print(f"❌ [InputGate] Failed JSON string: '{cleaned_json}'")

            # Strategy 2: Try to fix common JSON issues
            fixed_json = cleaned_json

            # Handle malformed quotes (common LLM issue: single quotes instead of double quotes)
            if "'" in fixed_json and '"' not in fixed_json:
                print(f"🔧 [InputGate] Detected single quotes, converting to double quotes")
                # Replace single quotes with double quotes for valid JSON
                fixed_json = fixed_json.replace("'", '"')
                try:
                    result = json.loads(fixed_json)
                    print(f"✅ [InputGate] Successfully parsed quote-fixed JSON: {result}")
                    return result
                except json.JSONDecodeError as e:
                    print(f"❌ [InputGate] Quote-fixed JSON still invalid: {e}")

            # Handle the specific error case: "key" appearing as literal string
            if '\"key\"' in fixed_json and fixed_json.strip() == '\"key\"':
                print(f"🔧 [InputGate] Detected literal 'key' string, returning empty dict")
                return {}

            # Add missing closing braces if needed
            open_braces = fixed_json.count('{')
            close_braces = fixed_json.count('}')
            if open_braces > close_braces:
                missing_braces = open_braces - close_braces
                fixed_json += '}' * missing_braces
                print(f"🔧 [InputGate] Added {missing_braces} missing closing braces")

                try:
                    result = json.loads(fixed_json)
                    print(f"✅ [InputGate] Successfully parsed fixed JSON: {result}")
                    return result
                except json.JSONDecodeError as e:
                    print(f"❌ [InputGate] Fixed JSON still invalid: {e}")

            print(f"❌ [InputGate] All JSON parsing strategies failed, returning empty dict")
            return {}

        except Exception as e:
            print(f"❌ [InputGate] Unexpected error in JSON parsing: {e}")
            print(f"❌ [InputGate] Input was: '{json_str}'")
            return {}



class InputGate:
    """Streaming input gate with routing decisions."""

    def __init__(self, stream_service: StreamService, tts_service=None, llm_service: Optional[LLMService] = None, task_manager=None, plan_service=None, processor=None):
        self.stream_service = stream_service
        self.tts_service = tts_service
        self.llm_service = llm_service or LLMService()
        self.task_manager = task_manager
        self.plan_service = plan_service
        self.processor = processor

        # Configuration for input gate
        self.config = LLMConfig(
            model="gpt-4o-mini",
            temperature=0.3,
            streaming=True,
            provider=LLMProvider.OPENAI_LANGCHAIN
        )

        # Common greetings that should NOT be interpreted as deliverable values
        self.greeting_patterns = [
            'hi', 'hello', 'hey', 'howdy', 'greetings', 'good morning',
            'good afternoon', 'good evening', 'hiya', 'yo', 'sup', 'what\'s up'
        ]

        # Initialize the modular prompt builder
        self.prompt_builder = PromptBuilder()

        # Track previous state for transition detection
        self.previous_state_id = None

    async def process_streaming(self, user_input: str, context: str = "", enable_voice_narration: bool = True) -> GateResult:
        """Process input with streaming response and routing decision."""

        try:
            print(f"[InputGate] Starting processing for: '{user_input}'")

            # Generate transcript ID and unique message ID for this input gate response
            transcript_id = self.stream_service.generate_stream_id()
            message_id = f"gate_{transcript_id}"  # Unique message ID for input gate responses

            await self.stream_service.send_decision_stream(
                "input_gate_start",
                "Processing input...",
                metadata={
                    "component": "input_gate",
                    "message_id": message_id
                }
            )

            # Create streaming callback with message tracking and voice narration preference
            callback = StreamingInputGateCallback(
                self.stream_service,
                transcript_id,
                self.tts_service if enable_voice_narration else None,  # Pass TTS only if voice narration is enabled
                message_id=message_id
            )

            # Build dynamic system prompt with current plan context
            system_prompt = self._build_system_prompt()

            # Prepare messages
            messages = [
                ("system", system_prompt),
                ("user", self._build_user_message(user_input, context))
            ]

            # Use the LLM service for streaming
            llm_messages = [LLMMessage(role=role, content=content) for role, content in messages]
            llm_response = await self.llm_service.generate(
                messages=llm_messages,
                config=self.config,
                callback=callback,
                component_name="input_gate"
            )

            response = llm_response.content

            # Parse the structured response
            try:
                thought, verdict, experts, llm_deliverables, state_transition, clean_response = callback.get_parsed_content()
            except Exception as e:
                print(f"❌ [InputGate] Error parsing LLM response content: {e}")
                # Fallback to safe defaults
                thought = ""
                verdict = "safe"
                experts = []
                llm_deliverables = {}
                state_transition = None
                clean_response = "I'm having some technical difficulties. Let me try to help you anyway!"

            # Debug logging for LLM response
            print(f"\n🤖 [InputGate] LLM RESPONSE PARSING:")
            print(f"🤖 [InputGate] - User input: '{user_input}'")
            print(f"🤖 [InputGate] - Thought: {thought[:100] if thought else 'None'}...")
            print(f"🤖 [InputGate] - Verdict: {verdict}")
            print(f"🤖 [InputGate] - Experts: {experts}")
            print(f"🤖 [InputGate] - Raw LLM deliverables: {llm_deliverables}")
            print(f"🤖 [InputGate] - State Transition: {state_transition}")
            print(f"🤖 [InputGate] - Clean response: '{clean_response[:100]}...' ")

            # Validate that deliverables are not simple greetings
            if llm_deliverables:
                print(f"🔍 [InputGate] Starting validation of LLM deliverables...")
                validated_deliverables = self._validate_deliverables_not_greetings(llm_deliverables, user_input)
            else:
                print(f"✅ [InputGate] No deliverables from LLM to validate")
                validated_deliverables = {}
            route_decision = "SAFE" if verdict == "safe" else "COMPLEX"

            # Set deliverables detected by LLM directly (after validation)
            if validated_deliverables and self.task_manager:
                await self._process_detected_deliverables(validated_deliverables, user_input)

            # Log response alignment with plan step (for monitoring, not enforcement)
            if self.task_manager and self.task_manager.plan_execution:
                current_step = self.task_manager.get_current_plan_step()
                if current_step:
                    self._log_step_alignment(current_step, clean_response, user_input)

            # Send final transcript chunk
            await self.stream_service.send_transcript_chunk(
                text=clean_response,
                is_final=True,
                transcript_id=transcript_id,
                confidence=0.9 if verdict == "safe" else 0.7
            )

            # Basic intent and risk analysis (fast heuristics)
            intent, risk_score = self._quick_analysis(user_input)

            # NEW: Turn counter logic for timekeeper trigger
            turn_counter = 0
            deliverables_extracted = bool(validated_deliverables and validated_deliverables != {})

            if self.task_manager:
                # Get current turn counter
                turn_counter = self.task_manager.get_turn_counter()
                print(f"[InputGate] Turn counter: {turn_counter} (threshold: 2)")

                # Check if we should trigger timekeeper
                should_trigger_timekeeper = (
                    turn_counter >= 2 and
                    not deliverables_extracted and
                    verdict == "safe"  # Only override SAFE verdicts
                )

                if should_trigger_timekeeper:
                    print(f"[InputGate] ⚠️  TIMEKEEPER TRIGGER: {turn_counter} turns without deliverables")
                    print(f"[InputGate] Overriding VERDICT to UNSAFE, setting EXPERTS to [timekeeper]")

                    # Override verdict and experts to trigger timekeeper
                    verdict = "unsafe"
                    experts = ["timekeeper"]
                    route_decision = "COMPLEX"  # Update route decision

                    print(f"[InputGate] Turn counter triggered timekeeper intervention")

                # Update turn counter based on deliverable extraction
                if deliverables_extracted:
                    print(f"[InputGate] Deliverables extracted - resetting turn counter")
                    self.task_manager.reset_turn_counter()
                else:
                    new_counter = self.task_manager.increment_turn_counter()
                    print(f"[InputGate] No deliverables extracted - turn counter now: {new_counter}")

            # Create expert configuration
            expert_configuration = None
            if verdict == "unsafe" and experts:
                expert_configuration = {
                    "experts": experts,
                    "reason": "timekeeper_trigger" if turn_counter >= 2 else "input_gate_decision",
                    "risk_score": risk_score,
                    "intent": intent
                }

            # Process message for deliverables and plan progression
            if self.task_manager:
                # Include LLM-detected deliverables in processing result
                processing_result = await self.task_manager.process_user_message(user_input)

                # Add validated LLM deliverables to processing result
                if validated_deliverables:
                    if not processing_result.get("deliverables_detected"):
                        processing_result["deliverables_detected"] = []
                    for key, deliverable_data in validated_deliverables.items():
                        if isinstance(deliverable_data, dict):
                            value = deliverable_data.get('value')
                            reasoning = deliverable_data.get('reasoning', '')
                        else:
                            value = deliverable_data
                            reasoning = ''

                        processing_result["deliverables_detected"].append({
                            "key": key,
                            "value": value,
                            "confidence": 0.95,
                            "source": "llm_detection",
                            "reasoning": reasoning
                        })

                await self._update_plan_progress(verdict, intent, user_input, clean_response, processing_result)

            # InputGate now handles all plan progression internally - no duplicate processing needed

            # Handle state transition if READY signal detected
            if state_transition == "READY":
                print(f"\n🚀 [InputGate] STATE_TRANSITION: READY detected!")
                print(f"🚀 [InputGate] AI has indicated all required deliverables are collected")

                # Check with state machine if state is actually complete
                if self.task_manager and self.task_manager.is_state_machine_mode():
                    state_machine = self.task_manager.state_machine
                    if state_machine and state_machine.execution_state.is_current_state_complete():
                        print(f"🚀 [InputGate] State machine confirms state is complete!")

                        # Evaluate transitions and advance if possible
                        next_state_id = state_machine.execution_state.evaluate_state_transitions()
                        if next_state_id:
                            success = state_machine.execution_state.advance_to_state(next_state_id)
                            if success:
                                print(f"🚀 [InputGate] Successfully advanced to state: {next_state_id}")

                                # Send notification to frontend
                                await self.stream_service.send_decision_stream(
                                    step="state_transition_ready",
                                    decision=f"State transition triggered - Advanced to: {next_state_id}",
                                    metadata={
                                        "trigger": "STATE_TRANSITION_READY",
                                        "previous_state": state_machine.execution_state.previous_state_id,
                                        "new_state": next_state_id,
                                        "ai_thought": thought[:200] if thought else ""
                                    }
                                )
                            else:
                                print(f"⚠️ [InputGate] Failed to advance to state: {next_state_id}")
                        else:
                            print(f"⚠️ [InputGate] No valid transition found despite READY signal")
                    else:
                        print(f"⚠️ [InputGate] READY signal received but state not actually complete")
                        print(f"⚠️ [InputGate] AI may have miscounted deliverables")

            await self.stream_service.send_decision_stream(
                "input_gate_complete",
                f"Verdict: {verdict}, Route: {route_decision}, Intent: {intent}, Risk: {risk_score:.2f}",
                confidence=0.9 if verdict == "safe" else 0.7,
                metadata={
                    "verdict": verdict,
                    "route": route_decision,
                    "intent": intent,
                    "risk_score": risk_score,
                    "expert_configuration": expert_configuration,
                    "state_transition": state_transition,
                    "thought_summary": thought[:100] if thought else ""
                }
            )

            return GateResult(
                verdict=verdict,
                route=route_decision,
                response=clean_response,
                expert_configuration=expert_configuration,
                intent=intent,
                risk_score=risk_score,
                confidence=0.9 if verdict == "safe" else 0.7,
                transcript_id=transcript_id,
                needs_expert_analysis=(verdict == "unsafe")
            )

        except Exception as e:
            print(f"❌ [InputGate] CRITICAL ERROR in process_streaming: {e}")
            print(f"❌ [InputGate] Error type: {type(e).__name__}")
            import traceback
            print(f"❌ [InputGate] Traceback: {traceback.format_exc()}")

            # Generate fallback IDs for error case
            transcript_id = self.stream_service.generate_stream_id()

            # Send error notification
            try:
                await self.stream_service.send_decision_stream(
                    "input_gate_critical_error",
                    f"Critical processing error: {str(e)}",
                    confidence=0.0,
                    metadata={"error_type": "critical_input_gate_failure", "error_details": str(e)}
                )
            except:
                print(f"❌ [InputGate] Could not even send error notification")

            # Return basic fallback result
            intent, risk_score = self._quick_analysis(user_input)
            return GateResult(
                verdict="safe",  # Default to safe to avoid expert routing issues
                route="SAFE",
                response="I'm experiencing technical difficulties. Please try again.",
                expert_configuration=None,
                intent=intent,
                risk_score=0.0,
                confidence=0.1,
                transcript_id=transcript_id,
                needs_expert_analysis=False
            )

    def _build_user_message(self, user_input: str, context: str) -> str:
        """Build the user message with plan-aware context including remaining steps."""
        # Detect state transitions for state machine mode
        state_transition_warning = ""
        state_info = ""

        if self.task_manager and self.task_manager.is_state_machine_mode():
            return self._build_state_machine_user_message(user_input, context)

        # Legacy mode handling
        current_step_info = ""
        remaining_steps_info = ""
        conversation_stage = "BEGINNING"

        if self.task_manager and self.task_manager.plan_execution:
            current_step = self.task_manager.get_current_plan_step()
            remaining_steps = self._get_remaining_steps()

            # Build current step info with deliverables
            if current_step:
                # Get current step index properly
                current_step_num = 1
                if self.task_manager.plan_execution.current_step_id:
                    step_index = self.task_manager.plan_execution.plan.get_step_index(self.task_manager.plan_execution.current_step_id)
                    if step_index >= 0:
                        current_step_num = step_index + 1

                current_step_info = f"""
CURRENT STEP ({current_step_num} of {len(self.task_manager.plan_execution.plan.steps)}): {current_step.title}
Step Goal: {current_step.instruction}
Step Type: {current_step.type.value}
"""
                # Add deliverable status with acceptance criteria
                if current_step.deliverables:
                    deliverable_status = "CURRENT STEP DELIVERABLES:\n"
                    for deliverable in current_step.deliverables:
                        state = self.task_manager.plan_execution.get_deliverable_state(deliverable.key)
                        status_text = state.status.value if state else "pending"
                        value_text = f" (collected: {state.value})" if state and state.value else ""

                        # Include acceptance criteria
                        criteria_text = ""
                        if hasattr(deliverable, 'acceptance_criteria') and deliverable.acceptance_criteria:
                            criteria_text = f"\n    Acceptance Criteria: {deliverable.acceptance_criteria}"

                        deliverable_status += f"- {deliverable.key}: {deliverable.description}{value_text}\n    Status: {status_text}{criteria_text}\n"
                    current_step_info += deliverable_status

            # Build remaining steps info
            if remaining_steps:
                remaining_steps_info = "\nUPCOMING STEPS (in order):\n"
                for idx, step in enumerate(remaining_steps[:5], 1):  # Show next 5 steps max
                    remaining_steps_info += f"{idx}. {step.title} ({step.type.value})\n"
                    if step.deliverables:
                        for d in step.deliverables:
                            req_text = "required" if d.required else "optional"
                            remaining_steps_info += f"   - {d.key}: {d.description} ({req_text})\n"

                if len(remaining_steps) > 5:
                    remaining_steps_info += f"... and {len(remaining_steps) - 5} more steps\n"

                # Determine conversation stage based on plan progress
                progress = self.task_manager.plan_execution.progress_percentage
                if progress < 25:
                    conversation_stage = "EARLY - Getting to know the user"
                elif progress < 50:
                    conversation_stage = "MIDDLE - Building rapport and gathering info"
                elif progress < 75:
                    conversation_stage = "ACTIVE - Main activities/exercises"
                else:
                    conversation_stage = "CLOSING - Wrapping up and feedback"

        # Check if this is likely just a greeting
        is_greeting = user_input.strip().lower() in self.greeting_patterns
        greeting_warning = ""
        if is_greeting:
            greeting_warning = "\n⚠️ USER MESSAGE IS A GREETING - DO NOT interpret it as a deliverable value!\n"

        if context:
            return f"""Conversation context: {context}
{current_step_info}{remaining_steps_info}
CONVERSATION STAGE: {conversation_stage}
{greeting_warning}
KEY INSTRUCTIONS:
1. Work toward collecting deliverables for current and possibly upcoming steps
2. You can handle multiple steps in one response if it flows naturally
3. Only detect deliverables when user provides explicit information (not greetings!)
4. Always provide reasoning for WHY a value matches acceptance criteria
5. If you need to ask questions, place them at the END of your message
6. Keep the conversation natural and engaging, not robotic

Current user message: {user_input}

Respond naturally while working toward the plan goals."""
        else:
            return f"""This appears to be the start of a new conversation.
{current_step_info}{remaining_steps_info}
CONVERSATION STAGE: {conversation_stage}
{greeting_warning}
FIRST MESSAGE GUIDANCE:
1. This is likely a greeting - respond warmly but don't assume it contains deliverables
2. Introduce yourself naturally based on the current step's goal
3. Begin working toward collecting the needed information
4. Remember: "Hi" or "Hello" is NOT a name - it's a greeting!
5. Place any questions at the END of your message

Current user message: {user_input}

Start the conversation naturally, guided by the plan goals."""

    def _build_state_machine_user_message(self, user_input: str, context: str) -> str:
        """Build user message specifically for state machine mode with transition detection."""
        state_machine = self.task_manager.state_machine
        current_state = state_machine.execution_state.current_state if state_machine else None

        if not current_state:
            return f"Current user message: {user_input}"

        # Detect state transition
        state_transition_warning = ""
        current_state_id = current_state.id

        if self.previous_state_id and self.previous_state_id != current_state_id:
            # State transition detected!
            previous_state = state_machine.execution_state.plan.get_state(self.previous_state_id)
            state_transition_warning = f"""
🚨 CRITICAL STATE TRANSITION DETECTED 🚨
===========================================
PREVIOUS STATE: {previous_state.title if previous_state else 'Unknown'} (COMPLETED ✓)
NEW STATE: {current_state.title} (ACTIVE NOW)
STATE TYPE: {current_state.type.value.upper()} MODE

⚠️ MANDATORY ACTION REQUIRED ⚠️
You MUST follow the CURRENT TASK instructions shown above in the state machine guidance.
The previous conversation topic is now COMPLETE.
Begin the new task naturally but clearly - transition the conversation to the new activity.
===========================================

"""

        # Update previous state tracker
        self.previous_state_id = current_state_id

        # Build state information (replaces CONVERSATION STAGE)
        state_info = f"""
CURRENT STATE: {current_state.title}
STATE TYPE: {current_state.type.value.upper()} MODE
DESCRIPTION: {current_state.description}
"""

        # Check if this is likely just a greeting
        is_greeting = user_input.strip().lower() in self.greeting_patterns
        greeting_warning = ""
        if is_greeting:
            greeting_warning = "\n⚠️ USER MESSAGE IS A GREETING - DO NOT interpret it as a deliverable value!\n"

        if context:
            return f"""{state_transition_warning}Conversation context: {context}
{state_info}{greeting_warning}
KEY INSTRUCTIONS:
1. Follow the CURRENT TASK guidance from the state machine (shown above)
2. Detect deliverables when user provides explicit information
3. Always provide reasoning for WHY a value matches acceptance criteria
4. Ask only ONE question per message maximum
5. Keep the conversation natural and engaging

Current user message: {user_input}

Respond naturally while following the current task guidance."""
        else:
            return f"""{state_transition_warning}This appears to be the start of a new conversation.
{state_info}{greeting_warning}
FIRST MESSAGE GUIDANCE:
1. This is likely a greeting - respond warmly but don't assume it contains deliverables
2. Follow the current task instruction naturally
3. Remember: "Hi" or "Hello" is NOT a name - it's a greeting!
4. Ask only ONE question at the end if needed

Current user message: {user_input}

Start the conversation naturally, following the current task guidance."""

    def _quick_analysis(self, user_input: str) -> Tuple[str, float]:
        """Quick heuristic analysis for intent and risk scoring.

        Note: This is a fast heuristic system that provides inspiration for the LLM.
        The LLM should use its semantic understanding for final routing decisions.
        """
        user_lower = user_input.lower()

        # Intent classification (simple keyword-based)
        if any(word in user_lower for word in ["hello", "hi", "hey", "how are you"]):
            intent = "chitchat"
        elif any(word in user_lower for word in ["?", "what", "how", "why", "when", "where"]):
            intent = "question"
        elif any(word in user_lower for word in ["help", "please", "can you", "could you"]):
            intent = "request"
        elif any(word in user_lower for word in ["do", "create", "make", "generate"]):
            intent = "command"
        else:
            intent = "question"

        # Risk scoring (simple heuristics for LLM inspiration)
        # Note: These are rough indicators - the LLM makes the final routing decision
        risk_score = 0.0

        # Medical/health keywords (general indicators)
        if any(word in user_lower for word in ["medical", "health", "doctor", "medicine", "drug", "symptom", "pain", "sick"]):
            risk_score += 0.4

        # Substance abuse patterns (stronger indicators, but context matters)
        if any(phrase in user_lower for phrase in ["hard drugs", "illegal drugs", "substance abuse", "recreational drugs", "drug use", "doing drugs"]):
            risk_score += 0.6

        # Additional drug-related patterns (context-dependent)
        if any(word in user_lower for word in ["drugs", "addiction", "overdose", "high", "stoned", "wasted"]):
            risk_score += 0.5

        # Legal keywords
        if any(word in user_lower for word in ["legal", "law", "lawyer", "sue", "court", "contract"]):
            risk_score += 0.3

        # Financial keywords
        if any(word in user_lower for word in ["invest", "money", "financial", "stock", "crypto", "bitcoin"]):
            risk_score += 0.2

        # Safety keywords
        if any(word in user_lower for word in ["dangerous", "harm", "hurt", "kill", "weapon", "bomb"]):
            risk_score += 0.6

        # Personal information
        if any(pattern in user_lower for pattern in ["@", "phone", "address", "ssn", "social security"]):
            risk_score += 0.3

        return intent, min(risk_score, 1.0)

    async def _update_plan_progress(self, verdict: str, intent: str, user_input: str, response: str, processing_result: Dict[str, Any]):
        """Enhanced plan progress with intelligent step chaining - handles multiple step transitions in one pass."""
        if not self.task_manager or not self.task_manager.plan_execution:
            return

        # Log processing results
        if processing_result.get("deliverables_detected"):
            print(f"[InputGate] Detected deliverables: {processing_result['deliverables_detected']}")

        step_changed = False
        steps_processed = []

        # For SAFE verdicts, InputGate handles intelligent step chaining
        if verdict == "safe":
            # Initialize first step if this is the first interaction
            if self.task_manager.is_first_interaction():
                self.task_manager.initialize_first_step()
                step_changed = True
                current_step = self.task_manager.get_current_plan_step()
                if current_step:
                    steps_processed.append(current_step.id)
                print(f"[InputGate] Initialized first step for first interaction")

            # Intelligent step chaining: process multiple steps if possible
            chaining_result = await self._process_intelligent_step_chaining(user_input, processing_result)
            if chaining_result.get("steps_processed"):
                step_changed = True
                steps_processed.extend(chaining_result["steps_processed"])
                print(f"[InputGate] Intelligent chaining processed steps: {steps_processed}")

        else:
            # For UNSAFE verdicts, ensure plan is started but leave progression to Aggregator
            if self.task_manager.is_first_interaction():
                self.task_manager.initialize_first_step()
                current_step = self.task_manager.get_current_plan_step()
                if current_step:
                    steps_processed.append(current_step.id)
                print(f"[InputGate] Started plan for first interaction (UNSAFE - Aggregator will handle progression)")

        # Send progress updates
        if step_changed or processing_result.get("deliverables_detected"):
            # Send step change notification for each processed step
            if step_changed and steps_processed:
                current_step = self.task_manager.get_current_plan_step()
                if current_step:
                    await self.stream_service.send_step_change_notification(
                        previous_step=steps_processed[0] if len(steps_processed) > 1 else "previous",
                        current_step=current_step.id,
                        step_title=current_step.title,
                        step_description=current_step.instruction,
                        action_taken="intelligent_step_chaining"
                    )

            # Send progress update with plan-aware data
            plan_summary = self.task_manager.plan_execution.get_progress_summary()
            await self.stream_service.send_task_progress_update(
                update_type="plan_progress_update",
                current_step=plan_summary["current_step"],
                progress=plan_summary["progress"],
                tasks={},  # Plan-based system doesn't use legacy tasks
                steps=plan_summary["steps"],
                metadata={
                    "verdict": verdict,
                    "intent": intent,
                    "step_changed": step_changed,
                    "steps_processed": steps_processed,
                    "component": "input_gate_intelligent_chaining",
                    "processing_result": processing_result,
                    "plan_id": plan_summary["plan_id"],
                    "deliverables_detected": len(processing_result.get("deliverables_detected", [])),
                    "deliverables_status": plan_summary["deliverables"]
                }
            )

            # Send complete todo list if step changed
            if step_changed:
                complete_todo_list = self.task_manager.get_complete_todo_list()
                await self.stream_service.send_complete_todo_list(
                    todo_list_data=complete_todo_list,
                    update_trigger="intelligent_step_chaining_by_input_gate"
                )

    async def _process_intelligent_step_chaining(self, user_input: str, processing_result: Dict[str, Any]) -> Dict[str, Any]:
        """Process intelligent step chaining - can advance through multiple steps in one user interaction."""
        result = {
            "steps_processed": [],
            "deliverables_set": [],
            "plan_completed": False
        }

        if not self.task_manager:
            return result

        # Skip intelligent step chaining for state machine mode (it handles its own processing)
        if self.task_manager.is_state_machine_mode():
            print(f"[InputGate] State machine mode - skipping intelligent step chaining")
            return result

        # Only proceed for legacy mode
        if not self.task_manager.is_legacy_mode() or not self.task_manager.plan_execution:
            return result

        current_step = self.task_manager.get_current_plan_step()
        if not current_step:
            return result

        max_chaining_iterations = 5  # Prevent infinite loops
        iteration = 0

        while iteration < max_chaining_iterations:
            iteration += 1
            current_step = self.task_manager.get_current_plan_step()

            if not current_step:
                # Plan completed
                result["plan_completed"] = True
                break

            print(f"[InputGate] Chaining iteration {iteration}: Processing step {current_step.id} ({current_step.type.value})")

            # For Question steps, always try to extract deliverables from user input first
            if current_step.type.value == "Question" and current_step.deliverables:
                for deliverable in current_step.deliverables:
                    # Try to extract deliverable value from user input
                    value, reasoning = self._extract_deliverable_value(user_input, deliverable, processing_result)
                    if value:
                        await self.task_manager.plan_execution.set_deliverable_value(
                            deliverable.key, value, user_input, 0.9, reasoning
                        )
                        result["deliverables_set"].append({
                            "key": deliverable.key,
                            "value": value,
                            "step_id": current_step.id,
                            "reasoning": reasoning
                        })
                        print(f"[InputGate] Set deliverable {deliverable.key} = {value} (Reasoning: {reasoning})")

            # Check if current step is completed based on deliverables and input
            step_completed = self._is_step_completed_by_input(current_step, user_input, processing_result)

            if step_completed:
                # Mark current step as completed
                result["steps_processed"].append(current_step.id)

                # Advance to next step
                if not self.task_manager.advance_to_next_step():
                    # No more steps - plan completed
                    result["plan_completed"] = True
                    break

                # Check if we can continue chaining to next step
                next_step = self.task_manager.get_current_plan_step()
                if next_step:
                    # For Statement steps, we can auto-advance them immediately
                    if next_step.type.value == "Statement":
                        # Statement steps are considered completed immediately
                        continue  # Will process this step in next iteration
                    elif next_step.type.value == "Question":
                        # Question steps need user input, but check if current input might answer next step too
                        # For now, stop chaining at Question steps to let user provide specific input
                        break
                    else:
                        # Unknown step type, stop chaining for safety
                        break
                else:
                    # No next step, plan completed
                    result["plan_completed"] = True
                    break
            else:
                # Current step is not completed by this input, stop chaining
                break

        return result

    def _is_step_completed_by_input(self, step, user_input: str, processing_result: Dict[str, Any]) -> bool:
        """Check if a step is completed by the current user input."""
        if step.type.value == "Statement":
            # Statement steps are always completed immediately
            return True
        elif step.type.value == "Question":
            # Question steps are completed if required deliverables can be extracted
            if not step.deliverables:
                return True  # No deliverables required

            # Check if we detected any deliverables in processing_result
            detected_deliverables = processing_result.get("deliverables_detected", [])
            if detected_deliverables:
                # Check if all required deliverables are covered
                required_keys = {d.key for d in step.deliverables if d.required}
                detected_keys = {d["key"] for d in detected_deliverables}
                return required_keys.issubset(detected_keys)

            # If no deliverables detected in processing_result, try LLM extraction
            for deliverable in step.deliverables:
                if deliverable.required:
                    value, reasoning = self._extract_deliverable_value(user_input, deliverable, processing_result)
                    if value:
                        return True

            return False
        else:
            # Unknown step type, assume not completed
            return False

    def _extract_deliverable_value(self, user_input: str, deliverable, processing_result: Dict[str, Any]) -> tuple[Optional[str], Optional[str]]:
        """Extract deliverable value ONLY from LLM-detected deliverables - no manual pattern matching.

        Returns:
            tuple: (value, reasoning) or (None, None) if not found
        """

        print(f"🔍 [InputGate] Checking LLM-detected deliverables for '{deliverable.key}'")

        # Only check if it was already detected by the LLM in processing_result
        detected_deliverables = processing_result.get("deliverables_detected", [])

        for detected in detected_deliverables:
            if detected["key"] == deliverable.key:
                value = detected["value"]
                reasoning = detected.get("reasoning", "")
                print(f"✅ [InputGate] Found LLM-detected deliverable: {deliverable.key} = '{value}' (reasoning: '{reasoning}')")

                # Validate the detected value against acceptance criteria
                if self._validate_deliverable_value(value, deliverable):
                    print(f"✅ [InputGate] LLM-detected value passed validation")
                    return value, reasoning
                else:
                    print(f"❌ [InputGate] LLM-detected value '{value}' for {deliverable.key} failed validation")
                    return None, None

        print(f"🚫 [InputGate] No LLM-detected deliverable for '{deliverable.key}' - returning None (no manual extraction)")

        # NO MANUAL EXTRACTION - Only trust LLM decisions
        # If the LLM didn't detect a deliverable, we don't extract one manually
        return None, None

    # Legacy method - kept for compatibility but replaced with plan-aware version
    async def _update_conversation_step(self, verdict: str, intent: str, user_input: str, response: str):
        """Legacy method - replaced by _update_plan_progress for plan-aware systems."""
        # This method is kept for backward compatibility but is no longer used
        # when TaskManager has plan_execution loaded
        pass

    def _build_system_prompt(self) -> str:
        """Build system prompt using the modular component system."""
        try:
            # Get current task strictness
            strictness = self._get_current_task_strictness()

            # Prepare context for components
            turn_count = self.processor.get_turn_count() if self.processor else 0
            context = {
                'strictness': strictness,
                'current_step': None,
                'plan_info': None,
                'turn_count': turn_count
            }

            # Add execution-specific context
            step_guidance_header = None

            if self.task_manager:
                if self.task_manager.is_state_machine_mode():
                    # Handle state machine context
                    state_context = self.task_manager.get_state_machine_context()
                    if state_context:
                        step_guidance_header = self._build_state_machine_guidance(state_context)
                        context['state_machine_context'] = state_context

                elif self.task_manager.is_legacy_mode():
                    # Handle legacy plan context
                    current_step = self.task_manager.get_current_plan_step()
                    plan_info = self.task_manager.plan_execution.plan

                    context['current_step'] = current_step
                    context['plan_info'] = plan_info

                    # Add step guidance header if we have a current step
                    if current_step:
                        step_guidance_header = self._build_legacy_step_guidance(current_step)

            # Build the prompt
            base_prompt = self.prompt_builder.build(context)
            if step_guidance_header:
                return step_guidance_header + "\n\n" + base_prompt
            else:
                return base_prompt

        except Exception as e:
            print(f"[InputGate] Error building system prompt: {e}")
            # Fallback to basic prompt
            fallback_context = {'strictness': 'moderate'}
            return self.prompt_builder.build(fallback_context)

    def _build_state_machine_guidance(self, state_context: Dict[str, Any]) -> str:
        """Build guidance for state machine execution."""
        state = state_context.get('state', {})
        current_task = state_context.get('current_task')
        next_task = state_context.get('next_task')
        next_state = state_context.get('next_state')
        available_tasks = state_context.get('available_tasks', [])
        processing_mode = state_context.get('processing_mode', 'unknown')
        conditional_paths = state_context.get('conditional_paths')

        guidance_header = f"""
📍 STATE MACHINE GUIDANCE 📍
==========================================
STATE: {state.get('title', 'Unknown')}
TYPE: {(state.get('type') or 'unknown').upper()} MODE
DESCRIPTION: {state.get('description', '')}

PROCESSING MODE: {(processing_mode or 'unknown').upper()}"""

        # Add collected deliverables section for STRICT mode
        if processing_mode == 'strict':
            current_state_id = state.get('id')
            if current_state_id and self.task_manager.state_machine:
                all_deliverable_states = self.task_manager.get_all_deliverable_states()
                if current_state_id in all_deliverable_states:
                    state_deliverables = all_deliverable_states[current_state_id].get('deliverables', {})
                    collected = {k: v for k, v in state_deliverables.items() if v.get('status') == 'completed'}

                    if collected:
                        guidance_header += """

✅ COLLECTED DELIVERABLES (already gathered in this state):"""
                        for key, deliverable_state in collected.items():
                            value = deliverable_state.get('value')
                            guidance_header += f"""
- {key}: "{value}" [Can be UPDATED if user provides new/corrected information]"""

        if processing_mode == 'strict':
            guidance_header += """

⚡ STRICT MODE: Process tasks sequentially, one at a time
==========================================

⚠️ MANDATORY ACTION ⚠️
In STRICT mode, you MUST focus on the CURRENT TASK below.
Follow the task instruction regardless of recent conversation topics.
If the conversation was about something else, naturally transition to this task.
==========================================

CURRENT TASK:"""
            if current_task:
                guidance_header += f"""
TASK: {current_task.get('description', '')}
INSTRUCTION: "{current_task.get('instruction', '')}"
REQUIRED: {current_task.get('required', True)}

DELIVERABLES TO GATHER:"""
                for deliverable in current_task.get('deliverables', []):
                    status = deliverable.get('status', 'pending')
                    value = deliverable.get('value')

                    # Status indicator
                    if status == 'completed':
                        status_text = f" [STATUS: COMPLETED (value: {value}) - can be updated if new evidence]"
                    elif status == 'skipped':
                        status_text = f" [STATUS: SKIPPED]"
                    else:
                        status_text = f" [STATUS: PENDING - needs collection]"

                    guidance_header += f"""
- {deliverable.get('key', '')}: {deliverable.get('description', '')}{status_text}"""

                    # Always show TYPE and REQUIRED
                    guidance_header += f"""
  TYPE: {deliverable.get('type', 'string')}, REQUIRED: {deliverable.get('required', True)}"""

                    # Always show acceptance criteria if available
                    if deliverable.get('acceptance_criteria'):
                        guidance_header += f"""
  ACCEPTANCE: {deliverable.get('acceptance_criteria')}"""

                    # Only show EXAMPLES for PENDING deliverables (not for completed/skipped)
                    if status == 'pending' and deliverable.get('examples'):
                        examples_list = deliverable.get('examples', [])[:3]  # Show first 3 examples
                        guidance_header += f"""
  EXAMPLES: {', '.join([f'"{ex}"' for ex in examples_list])}"""

            else:
                guidance_header += """
NO CURRENT TASK - This state may be complete."""

            # Add conditional paths information if present
            if conditional_paths:
                # Extract path information
                deliverable_key = conditional_paths.get('deliverable_key', 'unknown')
                deliverable_desc = conditional_paths.get('deliverable_description', '')
                deliverable_type = conditional_paths.get('deliverable_type', 'boolean')

                continue_path = conditional_paths['paths']['continue']
                skip_path = conditional_paths['paths']['skip']

                # Build task lists for each path
                continue_tasks_str = ""
                if continue_path.get('tasks'):
                    continue_task_ids = [t['id'] for t in continue_path['tasks']]
                    continue_tasks_str = f"\n  TASKS: {', '.join(continue_task_ids)}"

                skip_tasks_str = ""
                skip_tasks_to_skip = skip_path.get('tasks_to_skip', [])
                if skip_tasks_to_skip:
                    skip_tasks_str = f"\n  TASKS TO BE SKIPPED: {', '.join(skip_tasks_to_skip)}"

                guidance_header += f"""

🔀 CONDITIONAL DECISION POINT 🔀
==========================================
This task presents the user with a CHOICE that affects the conversation path.

DELIVERABLE: {deliverable_key} (type: {deliverable_type})
DESCRIPTION: {deliverable_desc}

PATH A - CONTINUE PATH ({deliverable_key} = true):
  Triggered by: User expresses desire to continue, enthusiasm, willingness to proceed
  Examples of responses: "Yes, let's keep going", "Sure!", "I want to try more", "Why not", "Absolutely"
  Meaning: {continue_path['description']}{continue_tasks_str}

PATH B - SKIP PATH ({deliverable_key} = false):
  Triggered by: User wants to stop, expresses fatigue, prefers to wrap up, declines
  Examples of responses: "No thanks", "Let's stop here", "I'm tired", "That's enough", "I'd rather not"
  Meaning: {skip_path['description']}
  Next state: {skip_path.get('next_state_title', 'Unknown')}{skip_tasks_str}

⚠️  IMPORTANT INSTRUCTIONS FOR CONDITIONAL TASKS:
1. Frame your question so the user understands both options
2. Understand the user's INTENT, not just specific keywords
3. Be supportive and accepting regardless of which path the user chooses
4. After detecting the deliverable, the system will AUTOMATICALLY:
   - Handle the path selection
   - Mark skipped tasks as SKIPPED if user chooses to skip
   - Transition to the appropriate next state
5. DO NOT manually transition - the system handles this
==========================================
"""

            # Add next task for transition preparation
            if next_task:
                guidance_header += """

NEXT TASK (for transition preparation):"""
                guidance_header += f"""
TASK: {next_task.get('description', '')}
INSTRUCTION: "{next_task.get('instruction', '')}"
REQUIRED: {next_task.get('required', True)}

UPCOMING DELIVERABLES:"""
                for deliverable in next_task.get('deliverables', []):
                    guidance_header += f"""
- {deliverable.get('key', '')}: {deliverable.get('description', '')}
  TYPE: {deliverable.get('type', 'string')}, REQUIRED: {deliverable.get('required', True)}"""

        elif processing_mode == 'loose':
            # Calculate state completion progress
            progress_summary = state_context.get('progress_summary', {})
            tasks_info = progress_summary.get('tasks', {})
            total_tasks = tasks_info.get('total', 0)
            completed_tasks = tasks_info.get('completed', 0)
            pending_tasks = len(available_tasks)

            guidance_header += f"""
🔄 LOOSE MODE: Process any available tasks flexibly
==========================================
STATE PROGRESS: {completed_tasks}/{total_tasks} tasks completed"""

            # Add urgency messaging when state is nearly complete
            if pending_tasks > 0 and pending_tasks <= 2:
                guidance_header += f"""
⚡ URGENT: Only {pending_tasks} task(s) remaining to complete this state!"""

            guidance_header += """

⚠️  DELIVERABLE UPDATE CAPABILITY (LOOSE MODE):
- You can UPDATE previously collected deliverables if the user provides new or corrected information
- Always use the MOST RECENT and MOST ACCURATE information provided by the user

AVAILABLE TASKS (still needed):"""
            for task in available_tasks:
                guidance_header += f"""

TASK: {task.get('description', '')}
INSTRUCTION: "{task.get('instruction', '')}"
REQUIRED: {task.get('required', True)}
DELIVERABLES:"""
                for deliverable in task.get('deliverables', []):
                    status = deliverable.get('status', 'pending')
                    value = deliverable.get('value')

                    # Status indicator
                    if status == 'completed':
                        status_text = f" [STATUS: COMPLETED (value: {value}) - can be updated if new evidence]"
                    elif status == 'skipped':
                        status_text = f" [STATUS: SKIPPED]"
                    else:
                        status_text = f" [STATUS: PENDING - needs collection]"

                    guidance_header += f"""
  - {deliverable.get('key', '')}: {deliverable.get('description', '')}{status_text}"""

                    # Always show TYPE and REQUIRED
                    guidance_header += f"""
    TYPE: {deliverable.get('type', 'string')}, REQUIRED: {deliverable.get('required', True)}"""

                    # Always show acceptance criteria if available
                    if deliverable.get('acceptance_criteria'):
                        guidance_header += f"""
    ACCEPTANCE: {deliverable.get('acceptance_criteria')}"""

                    # Only show EXAMPLES for PENDING deliverables (not for completed/skipped)
                    if status == 'pending' and deliverable.get('examples'):
                        examples_list = deliverable.get('examples', [])[:3]
                        guidance_header += f"""
    EXAMPLES: {', '.join([f'"{ex}"' for ex in examples_list])}"""

            # Add next state preview when close to completion
            if next_state and pending_tasks > 0 and pending_tasks <= 2:
                guidance_header += f"""

⚡ STATE TRANSITION PREVIEW:
Once all {total_tasks} tasks are complete, you'll advance to:
NEXT STATE: {next_state.get('title', 'Unknown')} ({next_state.get('type', 'unknown')})
DESCRIPTION: {next_state.get('description', '')}"""

                # Show preview of first tasks in next state
                preview_tasks = next_state.get('preview_tasks', [])
                if preview_tasks:
                    guidance_header += """
UPCOMING ACTIVITIES:"""
                    for i, preview_task in enumerate(preview_tasks[:2], 1):
                        guidance_header += f"""
  {i}. {preview_task.get('description', 'Unknown')}"""

                guidance_header += f"""

FOCUS: Complete the remaining {pending_tasks} task(s) to enable state transition!"""

        guidance_header += """

DELIVERABLE DETECTION:
Extract any mentioned values and include in DELIVERABLES field as JSON."""

        # Add LOOSE-mode specific update guidance
        if processing_mode == 'loose':
            guidance_header += """

⚠️  DELIVERABLE UPDATE CAPABILITY (LOOSE MODE):
- You can UPDATE previously collected deliverables if the user provides new or corrected information
- Example: User said "I'm from Munich" but later says "Actually, I'm from Neukeferloh" → UPDATE user_location
- Example: User said "My name is John" but later says "Call me Jonathan" → UPDATE user_name
- Always use the MOST RECENT and MOST ACCURATE information provided by the user
- Include updated deliverables in DELIVERABLES field just like new ones"""

        # Add mode-specific guidance
        if processing_mode == 'loose':
            guidance_header += """
In LOOSE mode, values can apply to any available task."""

        guidance_header += """

⚠️  CONVERSATION RULE: Ask only ONE question per message!
- If multiple deliverables are needed, focus on the most natural one for this turn
- Other deliverables will be collected in future messages naturally"""

        if processing_mode == 'loose':
            guidance_header += """
- When state is nearly complete, prioritize remaining tasks to enable progression"""

        return guidance_header

    def _build_legacy_step_guidance(self, current_step) -> str:
        """Build guidance for legacy plan execution."""
        step_guidance_header = f"""
📍 CURRENT STEP GUIDANCE 📍
==========================================
STEP: {current_step.title}
TYPE: {current_step.type.value}

STEP PURPOSE & INSPIRATION:
"{current_step.instruction}"

This gives you the direction and tone for this part of the conversation.
Use this as guidance for what to focus on, not as a script to follow word-for-word.
==========================================

INFORMATION TO NATURALLY GATHER:"""

        # Add deliverable information
        if current_step.deliverables:
            pending_deliverables = []
            for deliverable in current_step.deliverables:
                status = self.task_manager.plan_execution.get_deliverable_state(deliverable.key)
                status_text = f" ({status.status.value})" if status else " (pending)"
                step_guidance_header += f"\n- {deliverable.key}: {deliverable.description}{status_text}"

                # Add acceptance criteria if available
                if hasattr(deliverable, 'acceptance_criteria') and deliverable.acceptance_criteria:
                    step_guidance_header += f"\n  GUIDANCE: {deliverable.acceptance_criteria}"

                # Add examples if available
                if hasattr(deliverable, 'examples') and deliverable.examples:
                    examples_str = ", ".join(deliverable.examples)
                    step_guidance_header += f"\n  EXAMPLES: {examples_str}"

                # Track pending deliverables
                if not status or status.status.value == "pending":
                    pending_deliverables.append(deliverable)

            # Add explicit guidance for deliverable detection
            if pending_deliverables:
                step_guidance_header += "\n\nDELIVERABLE DETECTION:\nExtract these values from the user's response if provided:"
                for d in pending_deliverables:
                    step_guidance_header += f"\n- {d.key}: {d.description}"
                    if d.key == "user_location":
                        step_guidance_header += "\n  ANY place name is valid (city, town, country, region)"
                    elif d.key == "user_name":
                        step_guidance_header += "\n  ANY reasonable name the user provides"
                    elif d.key == "user_age":
                        step_guidance_header += "\n  ANY reasonable age number"
                step_guidance_header += "\nInclude detected values in DELIVERABLES field as JSON\n"

        return step_guidance_header

    async def _process_detected_deliverables(self, validated_deliverables: Dict[str, Any], user_input: str):
        """Process detected deliverables for both state machine and legacy modes."""
        if self.task_manager.is_state_machine_mode():
            await self._process_state_machine_deliverables(validated_deliverables, user_input)
        elif self.task_manager.is_legacy_mode():
            await self._process_legacy_deliverables(validated_deliverables, user_input)

    async def _process_state_machine_deliverables(self, validated_deliverables: Dict[str, Any], user_input: str):
        """Process deliverables for state machine execution."""
        state_machine = self.task_manager.state_machine
        if not state_machine:
            return

        for key, deliverable_data in validated_deliverables.items():
            # Extract value and reasoning from new format
            if isinstance(deliverable_data, dict):
                value = deliverable_data.get('value')
                reasoning = deliverable_data.get('reasoning', '')
            else:
                # Legacy format support
                value = deliverable_data
                reasoning = 'Legacy detection'

            # Check if this deliverable exists in any task
            if key in state_machine.execution_state.deliverable_states:
                # Only accept if LLM provided reasoning
                if reasoning and reasoning != 'Legacy detection':
                    await state_machine.execution_state.set_deliverable_value(
                        key, value, user_input, confidence=0.95, reasoning=reasoning
                    )
                    print(f"[InputGate] State machine deliverable {key}: {value} (Reasoning: {reasoning})")

                    # Check if this is a conditional deliverable that triggers task skipping
                    await self._handle_conditional_skip(key, value, state_machine)
                else:
                    print(f"[InputGate] Rejected state machine deliverable {key}: {value} - No reasoning provided")

    async def _handle_conditional_skip(self, deliverable_key: str, value: Any, state_machine):
        """Handle conditional task skipping based on deliverable value."""
        # Get conditional path info from state machine context
        state_context = state_machine.get_current_context()
        conditional_paths = state_context.get('conditional_paths')

        if not conditional_paths:
            return

        # Check if this deliverable triggers a skip
        if deliverable_key == conditional_paths.get('deliverable_key'):
            # Boolean deliverable: false means skip
            if isinstance(value, bool) and not value:
                # Get tasks to skip
                skip_path = conditional_paths['paths']['skip']
                tasks_to_skip = skip_path.get('tasks_to_skip', [])

                if tasks_to_skip:
                    print(f"[InputGate] Conditional skip triggered: {deliverable_key}={value}")
                    print(f"[InputGate] Skipping tasks: {tasks_to_skip}")

                    # Mark tasks as skipped
                    skipped = state_machine.skip_tasks(tasks_to_skip)

                    # Send notification to frontend
                    if self.stream_service and skipped:
                        await self.stream_service.send_decision_stream(
                            step="conditional_skip_executed",
                            decision=f"User chose to skip - marked {len(skipped)} tasks as SKIPPED",
                            metadata={
                                "deliverable_key": deliverable_key,
                                "deliverable_value": value,
                                "skipped_tasks": skipped,
                                "skip_reason": skip_path.get('description', 'User chose to skip'),
                                "next_state": skip_path.get('next_state_title', 'Unknown')
                            }
                        )

    async def _process_legacy_deliverables(self, validated_deliverables: Dict[str, Any], user_input: str):
        """Process deliverables for legacy plan execution."""
        plan_execution = self.task_manager.plan_execution
        if not plan_execution:
            return

        current_step = self.task_manager.get_current_plan_step()
        if not current_step:
            return

        for key, deliverable_data in validated_deliverables.items():
            # Extract value and reasoning from new format
            if isinstance(deliverable_data, dict):
                value = deliverable_data.get('value')
                reasoning = deliverable_data.get('reasoning', '')
            else:
                # Legacy format support
                value = deliverable_data
                reasoning = 'Legacy detection'

            # Check if this deliverable belongs to current or upcoming steps
            if any(d.key == key for d in current_step.deliverables):
                # Only accept if LLM provided reasoning
                if reasoning and reasoning != 'Legacy detection':
                    await plan_execution.set_deliverable_value(
                        key, value, user_input, confidence=0.95, reasoning=reasoning
                    )
                    print(f"[InputGate] Legacy deliverable {key}: {value} (Reasoning: {reasoning})")
                else:
                    print(f"[InputGate] Rejected legacy deliverable {key}: {value} - No reasoning provided")

    def _get_current_task_strictness(self) -> str:
        """Get the current task strictness setting from plan configuration."""
        try:
            if self.task_manager:
                # Handle state machine mode
                if self.task_manager.is_state_machine_mode():
                    # For state machine, check if plan has strictness settings
                    state_machine = self.task_manager.state_machine
                    if state_machine and hasattr(state_machine.execution_state.plan, 'custom_settings'):
                        plan = state_machine.execution_state.plan
                        if plan.custom_settings and isinstance(plan.custom_settings, dict):
                            if 'task_strictness' in plan.custom_settings:
                                strictness = plan.custom_settings['task_strictness']
                                print(f"[InputGate] Found state machine plan strictness: {strictness}")
                                return strictness
                    print(f"[InputGate] State machine mode - using default strictness")

                # Handle legacy mode
                elif self.task_manager.is_legacy_mode() and self.task_manager.plan_execution:
                    # Check for plan-specific strictness setting
                    plan = self.task_manager.plan_execution.plan
                    if hasattr(plan, 'custom_settings') and plan.custom_settings:
                        if isinstance(plan.custom_settings, dict) and 'task_strictness' in plan.custom_settings:
                            strictness = plan.custom_settings['task_strictness']
                            print(f"[InputGate] Found legacy plan strictness: {strictness}")
                            return strictness
                        else:
                            print(f"[InputGate] Plan custom_settings is not a dict or missing task_strictness: {type(plan.custom_settings)}")
                    else:
                        print(f"[InputGate] Plan has no custom_settings attribute")
                else:
                    print(f"[InputGate] Task manager in unknown mode")
            else:
                print(f"[InputGate] No task_manager available")
        except Exception as e:
            print(f"[InputGate] Error getting task strictness: {e}")

        # Fallback to default setting
        print(f"[InputGate] Using default strictness: moderate")
        return 'moderate'


    def _log_step_alignment(self, current_step, response: str, user_input: str) -> None:
        """Log alignment between response and current step for monitoring purposes."""
        # This is for monitoring and debugging, not enforcement
        step_keywords = []

        # Extract key concepts from step instruction
        if "name" in current_step.instruction.lower():
            step_keywords.append("name")
        if "age" in current_step.instruction.lower():
            step_keywords.append("age")
        if "where" in current_step.instruction.lower() or "from" in current_step.instruction.lower():
            step_keywords.append("location")
        if "hobbies" in current_step.instruction.lower() or "interests" in current_step.instruction.lower():
            step_keywords.append("hobbies")
        if "siblings" in current_step.instruction.lower() or "family" in current_step.instruction.lower():
            step_keywords.append("family")
        if "memory" in current_step.instruction.lower() or "shopping" in current_step.instruction.lower():
            step_keywords.append("memory_game")

        # Check if response seems generally aligned with step intent
        response_lower = response.lower()
        alignment_indicators = sum(1 for keyword in step_keywords if keyword in response_lower)

        alignment_status = "aligned" if alignment_indicators > 0 or not step_keywords else "general"

        print(f"[InputGate] Step alignment - Step: {current_step.id} ({current_step.title}), "
              f"Response alignment: {alignment_status}, Keywords found: {step_keywords}")

    def _validate_deliverable_value(self, value: str, deliverable) -> bool:
        """Validate if a deliverable value meets basic criteria."""
        if not value or not value.strip():
            return False

        # Only validate enum values for enum type deliverables
        if hasattr(deliverable, 'enum_values') and deliverable.enum_values:
            # Case-insensitive enum validation
            valid_values = [v.lower() for v in deliverable.enum_values]
            if value.lower() not in valid_values:
                return False

        return True

    def _get_remaining_steps(self) -> List[Any]:
        """Get list of remaining (uncompleted) steps in the plan."""
        if not self.task_manager or not self.task_manager.plan_execution:
            return []

        remaining = []
        plan_execution = self.task_manager.plan_execution

        # Get current step index using the plan's method
        current_index = -1
        if plan_execution.current_step_id:
            current_index = plan_execution.plan.get_step_index(plan_execution.current_step_id)

        # Include current step and all following steps that aren't completed
        if current_index >= 0:
            for i in range(current_index, len(plan_execution.plan.steps)):
                step = plan_execution.plan.steps[i]
                # Only include if not completed
                if step.id not in plan_execution.step_completion_times:
                    remaining.append(step)
        else:
            # If no current step, include all uncompleted steps
            for step in plan_execution.plan.steps:
                if step.id not in plan_execution.step_completion_times:
                    remaining.append(step)

        return remaining

    def _validate_deliverables_not_greetings(self, deliverables: Dict[str, Any], user_input: str) -> Dict[str, Any]:
        """Validate that deliverables are not simple greetings and exist in current state."""
        validated = {}
        user_lower = user_input.strip().lower()

        print(f"🔍 [InputGate] VALIDATION: Checking deliverables from LLM")
        print(f"🔍 [InputGate] User input: '{user_input}' (lower: '{user_lower}')")
        print(f"🔍 [InputGate] LLM detected deliverables: {deliverables}")
        print(f"🔍 [InputGate] Known greeting patterns: {self.greeting_patterns}")

        if not deliverables:
            print(f"✅ [InputGate] No deliverables to validate")
            return validated

        # Get valid deliverable keys from current state
        valid_keys = set()
        if self.task_manager:
            if self.task_manager.is_state_machine_mode():
                state_machine = self.task_manager.state_machine
                if state_machine and state_machine.execution_state.current_state:
                    current_state = state_machine.execution_state.current_state
                    for task in current_state.tasks:
                        for deliverable in task.deliverables:
                            valid_keys.add(deliverable.key)
                    print(f"🔍 [InputGate] Valid deliverable keys for current state '{current_state.title}': {valid_keys}")
            elif self.task_manager.is_legacy_mode():
                # For legacy mode, allow all deliverables (existing behavior)
                valid_keys = None
                print(f"🔍 [InputGate] Legacy mode - skipping deliverable key validation")

        for key, value_data in deliverables.items():
            print(f"\n🔍 [InputGate] Validating deliverable '{key}': {value_data}")

            # Validate deliverable key exists in current state (state machine mode only)
            if valid_keys is not None and key not in valid_keys:
                print(f"❌ [InputGate] REJECTED '{key}' - not a valid deliverable for current state!")
                print(f"❌ [InputGate] This appears to be a hallucinated deliverable")
                continue

            # Handle both new format with reasoning and legacy format
            if isinstance(value_data, dict):
                value = value_data.get('value', '')
                reasoning = value_data.get('reasoning', '')
                print(f"🔍 [InputGate] - Value: '{value}', Reasoning: '{reasoning}'")
            else:
                value = value_data
                reasoning = ''
                print(f"🔍 [InputGate] - Legacy format value: '{value}'")

            # Check if this is just a greeting being misinterpreted
            if key == 'user_name':
                print(f"🔍 [InputGate] - Validating user_name deliverable...")

                # Reject if the "name" is actually just a greeting
                if value.lower() in self.greeting_patterns:
                    print(f"❌ [InputGate] REJECTED '{value}' as user_name - it's in greeting patterns!")
                    continue

                # Reject if entire user input is just a greeting (no actual name provided)
                if user_lower in self.greeting_patterns and len(user_input.split()) <= 2:
                    print(f"❌ [InputGate] REJECTED name detection - user only provided greeting '{user_input}'")
                    continue

                # Additional robust checks for common greeting scenarios
                if value.lower() == user_lower and user_lower in ['hi', 'hello', 'hey', 'yo']:
                    print(f"❌ [InputGate] REJECTED '{value}' - detected value matches greeting input exactly!")
                    continue

                # Check if the detected "name" is suspiciously short and greeting-like
                if len(value.strip()) <= 3 and value.lower() in ['hi', 'hey', 'yo', 'sup']:
                    print(f"❌ [InputGate] REJECTED '{value}' - too short and greeting-like!")
                    continue

            # Validate reasoning exists for new format
            if isinstance(value_data, dict) and not reasoning:
                print(f"❌ [InputGate] REJECTED {key}: {value} - No reasoning provided")
                continue

            print(f"✅ [InputGate] ACCEPTED deliverable '{key}': {value}")
            validated[key] = value_data

        print(f"\n✅ [InputGate] VALIDATION COMPLETE: {len(validated)} deliverables passed validation")
        print(f"✅ [InputGate] Final validated deliverables: {validated}")
        return validated
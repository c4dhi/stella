"""
Main message processor that orchestrates the entire pipeline:
1. Echo user transcription
2. Streaming input gate with routing decision
3. Expert pool execution (if needed)
4. Aggregation with streaming response
"""
import asyncio
from typing import List, Dict, Any, Optional
from livekit import rtc

from .stream_service import StreamService
from .input_gate import InputGate, GateResult
from .expert_pool import ExpertPool
from .aggregator import Aggregator
from .simple_audio_transcription import SimpleAudioTranscriptionService
from .task_manager import TaskManager
from .plan_service import PlanService
from tts.service import TTSService
from .llm_service import LLMService

# Import FasterWhisperSTT (container-compatible, no pvporcupine) with fallback
try:
    from .faster_whisper_stt_service import FasterWhisperSTTService
    FASTER_WHISPER_STT_AVAILABLE = True
except ImportError as e:
    print(f"[MessageProcessor] WARNING: FasterWhisperSTT not available: {e}")
    FASTER_WHISPER_STT_AVAILABLE = False


class MessageProcessor:
    """Main orchestrator for message processing pipeline."""

    def __init__(self, room: rtc.Room, tts_provider: str = "opensource", stt_provider: str = "sherpa", agent_name: str = "task-manager", agent_icon: str = "🤖", plan_id: str = None):
        self.room = room
        self.stream_service = StreamService(room, agent_name=agent_name, agent_icon=agent_icon)

        # Global voice narration state - enabled by default
        self._voice_narration_enabled = True

        # Initialize shared LLM service with config file
        self.llm_service = LLMService(config_path="llm_config.json")

        # Initialize PlanService for intelligent step chaining and conversation management
        # This replaces TaskManager with enhanced plan execution capabilities
        self.plan_service = PlanService(stream_service=self.stream_service, llm_service=self.llm_service)

        # Keep TaskManager for backward compatibility (some components may still need it)
        self.task_manager = TaskManager(plan_name=plan_id)

        # Log which plan is being used
        if plan_id:
            print(f"[MessageProcessor] Using plan ID from environment: {plan_id}")
        else:
            print(f"[MessageProcessor] No plan ID specified, using config default")

        # Set stream service for real-time deliverable notifications
        self.task_manager.set_stream_service(self.stream_service)

        print(f"[MessageProcessor] PlanService initialized with intelligent step chaining")
        print(f"[MessageProcessor] TaskManager maintained for compatibility with stream service")
        print(f"[MessageProcessor] Real-time deliverable notifications enabled")

        # TTS provider is passed from main.py (centralized configuration)
        print(f"[MessageProcessor] Using TTS provider: {tts_provider}")

        # Initialize TTS service first (without callback initially)
        self.tts_service = TTSService(
            self.stream_service,
            room,
            provider_name=tts_provider
        )

        # Initialize components with shared LLM service, task manager, and plan service
        self.input_gate = InputGate(self.stream_service, self.tts_service, self.llm_service, self.task_manager, self.plan_service, processor=self)
        self.expert_pool = ExpertPool(self.stream_service, llm_service=self.llm_service)
        self.aggregator = Aggregator(self.stream_service, self.tts_service, self.llm_service, self.task_manager)

        # STT Provider Selection - centralized configuration
        print(f"[MessageProcessor] Using STT provider: {stt_provider}")
        self.stt_provider = stt_provider
        self.stt_uses_faster_whisper = False

        # Initialize appropriate STT service based on provider
        if stt_provider == "faster-whisper" and FASTER_WHISPER_STT_AVAILABLE:
            try:
                self.audio_transcription = FasterWhisperSTTService(
                    room=self.room,
                    stream_service=self.stream_service,
                    on_final_transcript=self.handle_transcribed_text,
                    language="en"  # or "de"
                )
                self.stt_uses_faster_whisper = True
                print(f"[MessageProcessor] ✅ FasterWhisper STT (container-compatible) initialized")
            except Exception as e:
                print(f"[MessageProcessor] ❌ FasterWhisper STT initialization failed: {e}")
                print(f"[MessageProcessor] Falling back to sherpa-onnx")
                self.audio_transcription = SimpleAudioTranscriptionService(
                    self.stream_service,
                    on_final_transcript=self.handle_transcribed_text,
                    language="en"
                )
                self.stt_provider = "sherpa"
        else:
            if stt_provider == "faster-whisper":
                print(f"[MessageProcessor] WARNING: FasterWhisper STT requested but not available")
                print(f"[MessageProcessor] Install with: pip install faster-whisper torch torchaudio")
                print(f"[MessageProcessor] Falling back to sherpa-onnx")
            self.audio_transcription = SimpleAudioTranscriptionService(
                self.stream_service,
                on_final_transcript=self.handle_transcribed_text,
                language="en"  # or "de"
            )
            self.stt_provider = "sherpa"

        # Set up TTS callback to transcription service for voice activity coordination
        self.tts_service.on_speaking_state_change = self.audio_transcription.on_assistant_speaking_change
        self.audio_transcription.set_tts_service(self.tts_service)

        self.conversation_history: List[Dict[str, Any]] = []
        self.system_assessments: List[Dict[str, Any]] = []

        # Processing lock to prevent concurrent AI pipeline execution
        self.processing_lock = asyncio.Lock()
        self.current_processing_text: Optional[str] = None

        # Plan initialization state (initialized before room connection)
        self.plan_initialized = False

    async def initialize_tts_audio_streaming(self):
        """Initialize TTS audio streaming after MessageProcessor is set up."""
        # Initialize provider and setup audio track
        await self.tts_service.initialize_provider()
        await self.tts_service.initialize_tts_audio_streaming()

    async def initialize_stt(self):
        """Initialize STT service (required for FasterWhisper STT)."""
        if self.stt_uses_faster_whisper:
            try:
                success = await self.audio_transcription.initialize()
                if success:
                    print(f"[MessageProcessor] ✅ FasterWhisper STT initialized successfully")
                    # Start transcription processing
                    await self.audio_transcription.start_transcription()
                    print(f"[MessageProcessor] ✅ FasterWhisper STT transcription started")
                else:
                    print(f"[MessageProcessor] ❌ FasterWhisper STT initialization failed")
                return success
            except Exception as e:
                print(f"[MessageProcessor] ❌ Error initializing FasterWhisper STT: {e}")
                return False
        else:
            print(f"[MessageProcessor] Using sherpa-onnx STT (no additional initialization needed)")
            return True

    async def initialize_plan(self):
        """Initialize the plan state machine (no room connection required)."""
        print(f"\n{'='*60}")
        print(f"[MessageProcessor] 🚀 INITIALIZING PLAN (Pre-Connection)")
        print(f"{'='*60}\n")

        # Check if plan is already initialized
        if self.task_manager.state_machine and self.task_manager.state_machine.execution_state.is_started:
            print(f"[MessageProcessor] ⚠️  Plan already initialized, skipping")
            self.plan_initialized = True
            return True

        # Initialize the TaskManager's state machine
        success = self.task_manager.initialize_first_step()
        if success:
            print(f"[MessageProcessor] ✅ TaskManager first step initialized successfully")

            # Get complete todo list with plan data
            complete_todo_list = self.task_manager.get_complete_todo_list()

            # Log plan data summary
            print(f"\n{'='*60}")
            print(f"[MessageProcessor] 📋 PLAN DATA SUMMARY:")
            print(f"  - Total states: {complete_todo_list.get('todo_list', {}).get('total_states', 0)}")
            print(f"  - Current state: {complete_todo_list.get('todo_list', {}).get('current_state', {})}")
            print(f"  - Architecture: {complete_todo_list.get('metadata', {}).get('architecture', 'unknown')}")
            print(f"  - States count: {complete_todo_list.get('metadata', {}).get('states_count', 0)}")
            print(f"  - Tasks count: {complete_todo_list.get('metadata', {}).get('tasks_count', 0)}")
            print(f"  - Deliverables count: {complete_todo_list.get('metadata', {}).get('deliverables_count', 0)}")
            print(f"{'='*60}\n")

            # Mark plan as initialized
            self.plan_initialized = True
            return True
        else:
            print(f"[MessageProcessor] ❌ Failed to initialize TaskManager first step")
            return False

    async def send_plan_to_frontend(self):
        """Send initialized plan data to frontend (requires room connection)."""
        if not self.plan_initialized:
            print(f"[MessageProcessor] ⚠️  Cannot send plan - not initialized yet")
            return False

        # Get complete todo list with plan data
        complete_todo_list = self.task_manager.get_complete_todo_list()

        # Send initial complete todo list with plan data to frontend
        send_success = await self.stream_service.send_complete_todo_list(
            todo_list_data=complete_todo_list,
            update_trigger="agent_connection_plan_start"
        )

        if send_success:
            print(f"[MessageProcessor] ✅ Successfully sent initial plan data to frontend")
        else:
            print(f"[MessageProcessor] ❌ Failed to send initial plan data to frontend")

        return send_success

    async def initialize_plan_on_connection(self):
        """Legacy method - now calls initialize_plan() and send_plan_to_frontend()."""
        await self.initialize_plan()
        await self.send_plan_to_frontend()

    async def pause_tts(self):
        """Pause TTS synthesis and streaming."""
        try:
            await self.tts_service.pause()
            print("[MessageProcessor] TTS pause request processed")
        except Exception as e:
            print(f"[MessageProcessor] Error pausing TTS: {e}")

    async def resume_tts(self):
        """Resume TTS synthesis and streaming."""
        try:
            await self.tts_service.resume()
            print("[MessageProcessor] TTS resume request processed")
        except Exception as e:
            print(f"[MessageProcessor] Error resuming TTS: {e}")

    def set_voice_narration_enabled(self, enabled: bool):
        """Set global voice narration state."""
        self._voice_narration_enabled = enabled
        print(f"[MessageProcessor] Voice narration globally {'enabled' if enabled else 'disabled'}")

    def get_voice_narration_enabled(self) -> bool:
        """Get current global voice narration state."""
        return self._voice_narration_enabled

    async def process_message(self, user_text: str, participant_id: str, is_voice_transcription: bool = False, enable_voice_narration: bool = True) -> bool:
        """Process a user message through the complete pipeline."""
        try:
            # Safety check: plan must be initialized (should always be true since we init pre-connection)
            if not self.plan_initialized:
                print(f"[MessageProcessor] ⚠️  WARNING: Plan not initialized - message will be skipped: '{user_text[:50]}...'")
                return False

            print(f"\n{'='*60}")
            print(f"[MessageProcessor] 📨 Processing message: '{user_text[:50]}...'")
            print(f"[MessageProcessor] - Participant: {participant_id}")
            print(f"[MessageProcessor] - Is voice: {is_voice_transcription}")
            print(f"[MessageProcessor] - Voice narration: {enable_voice_narration}")
            print(f"{'='*60}\n")

            # Clear assessments for new message
            self.system_assessments = []

            # Step 1: Echo text messages FIRST (but not voice transcriptions which are already sent)
            # This gives immediate feedback to the user while we process the message
            if not is_voice_transcription:
                print(f"[MessageProcessor] 📤 Echoing user message to frontend...")
                await self.echo_user_transcription(user_text, participant_id)

            # Step 2: Check if plan is initialized - initialize on first message if not already done
            # This handles cases where agent connects after user, or initialization failed during connection
            is_plan_initialized = (
                self.task_manager.state_machine and
                self.task_manager.state_machine.execution_state.is_started
            )
            is_first_message = self.task_manager.is_first_interaction()

            print(f"[MessageProcessor] 🔍 Plan status check:")
            print(f"  - Plan initialized: {is_plan_initialized}")
            print(f"  - First interaction: {is_first_message}")

            if not is_plan_initialized and is_first_message:
                print(f"\n{'='*60}")
                print(f"[MessageProcessor] 🚀 FIRST MESSAGE - Plan not yet initialized, initializing now")
                print(f"{'='*60}\n")

                # Initialize the TaskManager's state machine (idempotent)
                success = self.task_manager.initialize_first_step()
                if success:
                    print(f"[MessageProcessor] ✅ TaskManager first step initialized successfully")

                    # Get complete todo list with plan data
                    complete_todo_list = self.task_manager.get_complete_todo_list()

                    # Log plan data summary
                    print(f"\n{'='*60}")
                    print(f"[MessageProcessor] 📋 PLAN DATA SUMMARY:")
                    print(f"  - Total states: {complete_todo_list.get('todo_list', {}).get('total_states', 0)}")
                    print(f"  - Current state: {complete_todo_list.get('todo_list', {}).get('current_state', {})}")
                    print(f"  - Architecture: {complete_todo_list.get('metadata', {}).get('architecture', 'unknown')}")
                    print(f"  - States count: {complete_todo_list.get('metadata', {}).get('states_count', 0)}")
                    print(f"  - Tasks count: {complete_todo_list.get('metadata', {}).get('tasks_count', 0)}")
                    print(f"  - Deliverables count: {complete_todo_list.get('metadata', {}).get('deliverables_count', 0)}")
                    print(f"{'='*60}\n")

                    # Send initial complete todo list with plan data to frontend
                    send_success = await self.stream_service.send_complete_todo_list(
                        todo_list_data=complete_todo_list,
                        update_trigger="first_message_plan_start"
                    )

                    if send_success:
                        print(f"[MessageProcessor] ✅ Successfully sent initial plan data to frontend")
                    else:
                        print(f"[MessageProcessor] ❌ Failed to send initial plan data to frontend")
                else:
                    print(f"[MessageProcessor] ❌ Failed to initialize TaskManager first step")
            elif is_plan_initialized:
                print(f"[MessageProcessor] ✅ Plan already initialized - continuing with message processing")

            # Step 3: Streaming input gate - decides route while streaming initial response
            # NEW OPTIMAL FLOW: InputGate parses VERDICT/EXPERTS first, then streams MESSAGE
            # This allows expert pool to start immediately on UNSAFE route while message streams
            gate_result = await self.input_gate.process_streaming(
                user_input=user_text,
                context=self._get_recent_context(),
                enable_voice_narration=enable_voice_narration
            )

            # Step 4: Handle routing decision
            # PARALLEL EXECUTION: On UNSAFE route, InputGate message has streamed while we parse verdict
            # Expert pool will start immediately with parsed verdict/experts configuration
            if gate_result.verdict == "safe":
                # Safe route: response already streamed, update conversation history at end
                self._add_conversation_turn(user_text, gate_result.response, "input_gate")

                # Always send complete todo list with deliverables after input_gate (SAFE route)
                await self._send_complete_todo_list_update("safe_route_completed")

                # If voice narration is disabled, notify audio transcription of silent response completion
                if not enable_voice_narration:
                    await self._handle_silent_response_completion()

                return True

            elif gate_result.verdict == "unsafe":
                # Unsafe route: run expert analysis, will update history at end
                result = await self._handle_unsafe_route(user_text, gate_result, enable_voice_narration)

                # Always send complete todo list with deliverables after aggregator (UNSAFE route)
                await self._send_complete_todo_list_update("unsafe_route_completed")

                # If voice narration is disabled, notify audio transcription of silent response completion
                if not enable_voice_narration:
                    await self._handle_silent_response_completion()

                return result

            elif gate_result.route == "ERROR":
                # Input gate failed - send error response
                await self._send_error_response("Input gate processing failed")
                return False

            else:
                # Unknown route - send error instead of fallback
                await self._send_error_response(f"Unknown routing decision: {gate_result.route}")
                return False

        except Exception as e:
            await self._send_error_response(str(e))
            return False

    async def echo_user_transcription(self, user_text: str, participant_id: str) -> bool:
        """Echo the user's message back as a transcription so it appears in their chat."""
        try:
            success = await self.stream_service.send_transcript_chunk(
                text=user_text,
                is_final=True,
                participant_id=participant_id,  # Use original participant ID so it shows as user message
                confidence=1.0
            )

            if success:
                print(f"[MessageProcessor] Echoed user transcription: {user_text}")
            else:
                print(f"[MessageProcessor] Failed to echo transcription")

            return success

        except Exception as e:
            print(f"[MessageProcessor] Echo failed: {e}")
            return False

    async def _handle_unsafe_route(self, user_text: str, gate_result: GateResult, enable_voice_narration: bool = True) -> bool:
        """Handle complex routing with expert pool analysis."""
        try:
            # Step 1: Use expert configuration from input_gate or fallback to selection
            if gate_result.expert_configuration and gate_result.expert_configuration.get("experts"):
                # Use experts specified by input_gate
                relevant_experts = gate_result.expert_configuration["experts"]
                print(f"[MessageProcessor] Using input_gate expert configuration: {relevant_experts}")
            else:
                # Fallback to automatic selection
                relevant_experts = self.expert_pool.select_relevant_agents(
                    user_input=user_text,
                    intent=gate_result.intent,
                    risk_score=gate_result.risk_score
                )

            if not relevant_experts:
                # No experts selected - send error message
                await self._send_error_response("No relevant experts found for query")
                return False

            # Step 2: Run expert pool in parallel
            print(f"[MessageProcessor] Running {len(relevant_experts)} experts: {relevant_experts}")

            expert_results = await self.expert_pool.run_parallel(
                agent_names=relevant_experts,
                user_input=user_text,
                context=self._get_recent_context()
            )

            # Send expert results to frontend as status
            successful_results = [r for r in expert_results if r.get("success")]
            failed_results = [r for r in expert_results if not r.get("success")]

            await self.stream_service.send_expert_results(
                expert_results=expert_results,
                total_experts=len(relevant_experts),
                successful_count=len(successful_results),
                failed_count=len(failed_results)
            )

            # Step 3: Aggregate expert findings with streaming, passing input_gate message, system assessments, conversation context, and plan context
            plan_context = self._build_plan_context_for_aggregator()
            aggregator_result = await self.aggregator.synthesize_streaming(
                user_input=user_text,
                expert_findings=expert_results,
                input_gate_message=gate_result.response,
                system_assessments=self.system_assessments,
                conversation_context=self._get_recent_context(),
                enable_voice_narration=enable_voice_narration,
                plan_context=plan_context
            )

            # Check if aggregation failed
            if aggregator_result.confidence_score == 0.0 and not aggregator_result.consolidated_response:
                # Aggregation failed - send error
                await self._send_error_response("Expert analysis synthesis failed")
                return False

            # Update conversation history with complete turn (user + input gate + aggregator)
            self._add_conversation_turn(user_text, aggregator_result.consolidated_response, "aggregator", gate_result.response)

            print(f"[MessageProcessor] Unsafe route completed (confidence: {aggregator_result.confidence_score:.2f})")
            return True

        except Exception as e:
            print(f"[MessageProcessor] Unsafe route failed: {e}")
            await self._send_error_response(f"Expert analysis failed: {e}")
            return False

    def get_turn_count(self) -> int:
        """Get the current conversation turn count (1 turn = user message + assistant response)."""
        return len(self.conversation_history) // 2

    def _get_recent_context(self) -> str:
        """Get recent conversation context with emphasis on most recent messages."""
        if len(self.conversation_history) <= 1:
            return ""

        # Get last 4 exchanges (8 messages max) for better context
        recent_messages = self.conversation_history[-8:]
        context_parts = []

        total_messages = len(recent_messages)
        for i, msg in enumerate(recent_messages):
            role = msg["role"]
            content = msg["content"]

            # Add emphasis markers for most recent messages (last 2-4 messages get special treatment)
            if i >= total_messages - 4:
                # Mark as recent context - these are the most important messages
                if i >= total_messages - 2:
                    context_parts.append(f"[MOST RECENT] {role}: {content}")
                else:
                    context_parts.append(f"[RECENT] {role}: {content}")
            else:
                context_parts.append(f"{role}: {content}")

        return "\n".join(context_parts)

    def _add_conversation_turn(self, user_text: str, final_response: str, response_type: str, input_gate_response: str = None) -> None:
        """Add a complete conversation turn to history at the end of processing."""
        # Add user message
        self._add_to_history_silent("user", user_text)

        # For unsafe route, optionally add input gate message if it's meaningful
        if response_type == "aggregator" and input_gate_response and input_gate_response.strip():
            self._add_to_history_silent("assistant", input_gate_response)

        # Add final response
        self._add_to_history_silent("assistant", final_response)

        # Get updated task list data to include in the completion message
        complete_task_list = None
        plan_progress = None
        try:
            complete_task_list = self.task_manager.get_complete_todo_list()
            if self.task_manager.is_state_machine_mode():
                plan_progress = self.task_manager.get_progress_summary()
        except Exception as e:
            print(f"[MessageProcessor] Warning: Could not get task list for turn completion: {e}")

        # Send single notification for the complete turn with embedded task list data
        # This allows frontend to get both conversation completion AND updated task list in one message
        asyncio.create_task(
            self.stream_service.send_decision_stream(
                step="conversation_turn_complete",
                decision=f"Added conversation turn to history ({response_type} response)",
                metadata={
                    "user_message_length": len(user_text),
                    "response_type": response_type,
                    "final_response_length": len(final_response),
                    "history_size": len(self.conversation_history),
                    "includes_input_gate": response_type == "aggregator" and bool(input_gate_response and input_gate_response.strip()),
                    "complete_task_list": complete_task_list,
                    "plan_progress": plan_progress
                }
            )
        )

    def _add_to_history_silent(self, role: str, content: str) -> None:
        """Add message to conversation history without notification."""
        self.conversation_history.append({
            "role": role,
            "content": content,
            "timestamp": asyncio.get_event_loop().time()
        })

        # Keep last 20 messages to prevent memory growth
        if len(self.conversation_history) > 20:
            self.conversation_history = self.conversation_history[-20:]

    def _add_to_history(self, role: str, content: str) -> None:
        """Add message to conversation history."""
        self.conversation_history.append({
            "role": role,
            "content": content,
            "timestamp": asyncio.get_event_loop().time()
        })

        # Keep last 20 messages to prevent memory growth
        if len(self.conversation_history) > 20:
            self.conversation_history = self.conversation_history[-20:]

        # Determine message type for notification
        message_type = "user_input"
        if role == "assistant":
            # Check if this is likely an input gate response or aggregator response
            # Input gate responses are typically shorter and happen early in conversation
            if len(content) < 500 and len(self.conversation_history) <= 4:
                message_type = "input_gate_response"
            else:
                message_type = "aggregator_response"

        # Notify frontend about history update
        asyncio.create_task(
            self.stream_service.send_decision_stream(
                step="conversation_memory_update",
                decision=f"Added {role} message to conversation history",
                metadata={
                    "role": role,
                    "content_length": len(content),
                    "history_size": len(self.conversation_history),
                    "message_type": message_type
                }
            )
        )

    def reset_conversation_history(self, participant_id: str) -> None:
        """Reset conversation history and plan execution when participant leaves."""
        history_size = len(self.conversation_history)
        self.conversation_history.clear()
        self.system_assessments.clear()

        # Reset plan completion tracking
        if hasattr(self, '_plan_completion_sent'):
            delattr(self, '_plan_completion_sent')

        # Reinitialize TaskManager to reset plan state
        old_plan_id = None
        if self.task_manager.is_state_machine_mode():
            old_plan_id = self.task_manager.state_machine.execution_state.plan.id

        self.task_manager = TaskManager()  # This will reload the default plan
        # Set stream service for real-time deliverable notifications
        self.task_manager.set_stream_service(self.stream_service)

        # Also reset PlanService for new conversation
        self.plan_service = PlanService(stream_service=self.stream_service, llm_service=self.llm_service)

        # Update InputGate with new services and reset its state tracking
        self.input_gate = InputGate(self.stream_service, self.tts_service, self.llm_service, self.task_manager, self.plan_service, processor=self)
        # Note: Creating a new InputGate automatically resets previous_state_id to None

        print(f"[MessageProcessor] Reset conversation history and plan state for {participant_id} ({history_size} messages cleared)")
        if old_plan_id:
            print(f"[MessageProcessor] Plan execution reset: {old_plan_id}")
        print(f"[MessageProcessor] PlanService reset for new conversation")

        # Verify state machine is in fresh/unstarted state
        if self.task_manager.is_state_machine_mode():
            is_started = self.task_manager.state_machine.execution_state.is_started
            print(f"[MessageProcessor] State machine reset verification:")
            print(f"  - State machine is_started: {is_started}")
            print(f"  - Will reinitialize on next user message: {not is_started}")

        # Get fresh todo list from newly initialized TaskManager (will be empty/initial state)
        fresh_todo_list = self.task_manager.get_complete_todo_list()

        # Notify frontend about full reset
        asyncio.create_task(
            self.stream_service.send_decision_stream(
                step="full_conversation_reset",
                decision=f"Conversation and plan state reset for participant {participant_id}",
                metadata={
                    "participant_id": participant_id,
                    "messages_cleared": history_size,
                    "plan_reset": True,
                    "old_plan_id": old_plan_id,
                    "reason": "participant_disconnected"
                }
            )
        )

        # Send fresh/reset todo list to clear the frontend UI and show initial state
        asyncio.create_task(
            self.stream_service.send_complete_todo_list(
                todo_list_data=fresh_todo_list,
                update_trigger="participant_disconnected",
                participant_id=participant_id
            )
        )

    async def _send_error_response(self, error_message: str) -> None:
        """Send an error message to the user via the frontend."""
        # Send error message to frontend via decision stream
        await self.stream_service.send_decision_stream(
            "system_error",
            f"System Error: {error_message}",
            confidence=0.0,
            metadata={
                "error_type": "processing_error",
                "error_message": error_message,
                "user_message": "I apologize, but I'm experiencing technical difficulties. Please try again in a moment."
            }
        )

        # Also send a user-friendly message as transcript
        user_friendly_message = "I apologize, but I'm experiencing technical difficulties right now. Please try again in a moment."
        await self.stream_service.send_transcript_chunk(
            text=user_friendly_message,
            is_final=True,
            confidence=0.0  # Low confidence indicates error state
        )

    def get_conversation_history(self) -> List[Dict[str, str]]:
        """Get the current conversation history."""
        return self.conversation_history.copy()

    def clear_conversation_history(self) -> None:
        """Clear the conversation history."""
        self.conversation_history.clear()
        print("[MessageProcessor] Conversation history cleared")

    def capture_system_assessment(self, assessment: Dict[str, Any]) -> None:
        """Capture system assessment for aggregator processing."""
        self.system_assessments.append(assessment)
        print(f"[MessageProcessor] Captured system assessment: {assessment.get('data', {}).get('issue_type', 'unknown')}")

    def get_agent_info(self) -> Dict[str, Any]:
        """Get information about available agents."""
        return {
            "available_agents": self.expert_pool.get_agent_info(),
            "total_agents": len(self.expert_pool.agents),
            "conversation_length": len(self.conversation_history)
        }

    def _build_plan_context_for_aggregator(self) -> Dict[str, Any]:
        """Build plan context for the aggregator to handle problematic conversations appropriately."""
        plan_context = {}

        if self.task_manager and self.task_manager.is_state_machine_mode():
            # Get state machine context which includes current_task, next_task, next_state, and processing_mode
            sm_context = self.task_manager.get_state_machine_context()

            if sm_context:
                # Build current_step info from state machine context
                state_info = sm_context.get("state", {})
                current_task = sm_context.get("current_task")
                next_task = sm_context.get("next_task")
                next_state = sm_context.get("next_state")
                processing_mode = sm_context.get("processing_mode", "unknown")

                step_info = {
                    "id": state_info.get("id"),
                    "title": state_info.get("title"),
                    "instruction": state_info.get("description"),
                    "type": processing_mode,
                    "deliverables": []
                }

                # Add current task deliverables
                if current_task and current_task.get("deliverables"):
                    for deliverable in current_task["deliverables"]:
                        deliverable_info = {
                            "key": deliverable.get("key"),
                            "type": deliverable.get("type"),
                            "description": deliverable.get("description"),
                            "required": deliverable.get("required"),
                            "status": deliverable.get("status", "pending")
                        }
                        step_info["deliverables"].append(deliverable_info)

                plan_context["current_step"] = step_info
                plan_context["processing_mode"] = processing_mode

                # Add next task for strict mode (for transition preparation)
                if next_task and processing_mode == "strict":
                    next_task_info = {
                        "id": next_task.get("id"),
                        "description": next_task.get("description"),
                        "instruction": next_task.get("instruction"),
                        "required": next_task.get("required"),
                        "deliverables": []
                    }

                    # Add next task deliverables
                    if next_task.get("deliverables"):
                        for deliverable in next_task["deliverables"]:
                            deliverable_info = {
                                "key": deliverable.get("key"),
                                "type": deliverable.get("type"),
                                "description": deliverable.get("description"),
                                "required": deliverable.get("required"),
                                "status": deliverable.get("status", "pending")
                            }
                            next_task_info["deliverables"].append(deliverable_info)

                    plan_context["next_task"] = next_task_info

                # Add next state for state transition awareness (both loose and strict)
                if next_state:
                    next_state_info = {
                        "id": next_state.get("id"),
                        "title": next_state.get("title"),
                        "type": next_state.get("type"),
                        "description": next_state.get("description"),
                        "preview_tasks": next_state.get("preview_tasks", [])
                    }
                    plan_context["next_state"] = next_state_info

            # Get user information from deliverables using state machine
            user_info = {}
            all_deliverable_states = self.task_manager.get_all_deliverable_states()

            # Extract user information from any state
            for state_data in all_deliverable_states.values():
                for key, deliverable in state_data.get("deliverables", {}).items():
                    if key == "user_name" and deliverable.get("value"):
                        user_info["user_name"] = deliverable["value"]
                    elif key == "communication_style" and deliverable.get("value"):
                        user_info["communication_style"] = deliverable["value"]

            if user_info:
                plan_context["user_info"] = user_info

            # Add progress information from state machine
            progress_summary = self.task_manager.get_progress_summary()
            plan_context["progress"] = {
                "percentage": progress_summary["progress"]["percentage"],
                "current_step_index": progress_summary["progress"]["current_state_index"]
            }

            # Add remaining steps information for complete context awareness
            remaining_steps = self.task_manager.get_remaining_steps()
            remaining_steps_data = []
            for step in remaining_steps:
                step_data = {
                    "id": step.id,
                    "title": step.title,
                    "type": step.type.value,
                    "deliverables": []
                }

                # Add deliverable info for remaining steps
                for deliverable in step.deliverables:
                    deliverable_data = {
                        "key": deliverable.key,
                        "description": deliverable.description,
                        "required": deliverable.required,
                        "type": deliverable.type.value
                    }

                    # Add acceptance criteria and examples
                    if hasattr(deliverable, 'acceptance_criteria') and deliverable.acceptance_criteria:
                        deliverable_data["acceptance_criteria"] = deliverable.acceptance_criteria
                    if hasattr(deliverable, 'examples') and deliverable.examples:
                        deliverable_data["examples"] = deliverable.examples

                    step_data["deliverables"].append(deliverable_data)

                remaining_steps_data.append(step_data)

            plan_context["remaining_steps"] = remaining_steps_data

            # Add all deliverable states for complete visibility
            all_deliverable_states = self.task_manager.get_all_deliverable_states()
            if all_deliverable_states:
                plan_context["all_deliverable_states"] = all_deliverable_states

        return plan_context

    # Room-level audio transcription methods - simplified approach
    async def handle_audio_stream_start(self, data: Dict[str, Any], room_id: str = "room") -> bool:
        """Handle audio stream start - room-level logging."""
        try:
            print(f"[MessageProcessor] Room audio stream started")
            return True
        except Exception as e:
            print(f"[MessageProcessor] Audio stream start failed: {e}")
            return False

    async def handle_audio_stream_chunk(self, data: Dict[str, Any], room_id: str = "room") -> bool:
        """Handle incoming room audio chunk."""
        try:
            # Get audio data - frontend sends as array of integers
            audio_data = data.get("audio", [])
            if not audio_data:
                return True  # Skip empty chunks

            # Process the audio chunk directly at room level
            await self.audio_transcription.process_audio_chunk(audio_data, room_id)
            return True

        except Exception as e:
            print(f"[MessageProcessor] Audio chunk processing failed: {e}")
            return False

    async def handle_audio_stream_stop(self, data: Dict[str, Any], room_id: str = "room") -> bool:
        """Handle audio stream stop - just log, keep transcription session alive."""
        try:
            print(f"[MessageProcessor] Audio stream stop signal received (keeping session alive)")
            # Note: We don't actually stop anything - just log the signal
            # VAD will naturally detect endpoints when chunks stop flowing
            return True
        except Exception as e:
            print(f"[MessageProcessor] Audio stream stop failed: {e}")
            return False

    async def handle_audio_stream_mute(self, data: Dict[str, Any], room_id: str = "room") -> bool:
        """Handle audio stream mute signal - force VAD endpoint detection."""
        try:
            reason = data.get("reason", "unknown")
            print(f"[MessageProcessor] Audio stream mute signal received (reason: {reason}) - triggering VAD endpoint")

            # Trigger VAD endpoint in the audio transcription service
            await self.audio_transcription.handle_mute_signal(room_id)

            return True
        except Exception as e:
            print(f"[MessageProcessor] Audio stream mute handling failed: {e}")
            return False

    async def handle_transcribed_text(self, transcribed_text: str, room_id: str = "room") -> bool:
        """Handle final transcribed text from audio and process it through the pipeline."""
        try:
            # Check if we're already processing this exact text or if pipeline is busy
            if self.processing_lock.locked():
                if self.current_processing_text == transcribed_text:
                    print(f"[MessageProcessor] Duplicate processing request for: '{transcribed_text}' - ignoring")
                    return True
                else:
                    print(f"[MessageProcessor] Pipeline busy processing different text, queuing: '{transcribed_text}'")

            # Acquire lock and process
            async with self.processing_lock:
                self.current_processing_text = transcribed_text
                print(f"[MessageProcessor] Processing transcribed text: {transcribed_text}")

                try:
                    # Pass current voice narration state to ensure TTS respects user preference
                    result = await self.process_message(transcribed_text, room_id, is_voice_transcription=True, enable_voice_narration=self.get_voice_narration_enabled())
                    return result
                finally:
                    self.current_processing_text = None

        except Exception as e:
            print(f"[MessageProcessor] Transcribed text processing failed: {e}")
            self.current_processing_text = None
            return False

    async def _send_turn_completion_todo_list(self, update_trigger: str = "turn_completion") -> bool:
        """Send updated todo list and plan progress to frontend after turn completion."""
        try:
            complete_todo_list = self.task_manager.get_complete_todo_list()
            success = await self.stream_service.send_complete_todo_list(
                todo_list_data=complete_todo_list,
                update_trigger=update_trigger
            )

            # Also send plan progress update if using state machine
            if success and self.task_manager.is_state_machine_mode():
                plan_summary = self.task_manager.get_progress_summary()
                session_id = complete_todo_list["conversation_id"]

                # Format progress data for frontend expectations (with null safety)
                current_state = plan_summary.get("current_state", {})
                progress_info = plan_summary.get("progress", {})

                frontend_progress = {
                    "percentage": progress_info.get("percentage", 0),
                    "state": current_state.get("title", "Unknown State"),
                    "mode": current_state.get("type", "unknown"),
                    "state_id": current_state.get("id"),
                    "description": current_state.get("description", ""),
                    "total_states": progress_info.get("total_states", 0),
                    "completed_states": progress_info.get("completed_states", 0),
                    "current_state_index": progress_info.get("current_state_index", 0)
                }

                await self.stream_service.send_plan_progress_update(
                    session_id=session_id,
                    progress=frontend_progress,
                    current_step=plan_summary["current_state"],  # Use current_state from state machine
                    deliverables=plan_summary["deliverables"],
                    participant_id="plan-service",
                    stream_id="plan-progress-stream"
                )

                # Send plan completion notification if plan is completed
                if plan_summary["is_completed"] and not hasattr(self, '_plan_completion_sent'):
                    await self.stream_service.send_plan_completed(
                        session_id=session_id,
                        plan_id=plan_summary["plan_id"],
                        plan_title=plan_summary["plan_title"],
                        deliverables=plan_summary["deliverables"],
                        completion_time=plan_summary["completed_at"],
                        participant_id="plan-service",
                        stream_id="plan-completion-stream"
                    )
                    self._plan_completion_sent = True
                    print(f"[MessageProcessor] Plan completed: {plan_summary['plan_title']}")

            if success:
                if self.task_manager.is_state_machine_mode():
                    current_step = self.task_manager.get_current_plan_step()
                    step_title = current_step.title if current_step else "Unknown"
                    progress = complete_todo_list["todo_list"]["progress_percentage"]
                    print(f"[MessageProcessor] Sent updated plan data - Step: '{step_title}' ({progress:.1f}% complete)")
                else:
                    current_step = self.task_manager.get_current_step()
                    step_title = current_step.title if current_step else "Unknown"
                    progress = complete_todo_list["todo_list"]["progress_percentage"]
                    print(f"[MessageProcessor] Sent updated todo list - Step: '{step_title}' ({progress:.1f}% complete)")

            return success
        except Exception as e:
            print(f"[MessageProcessor] Failed to send turn completion data: {e}")
            return False

    async def _send_complete_todo_list_update(self, update_trigger: str) -> bool:
        """Send complete todo list with all deliverable states to frontend."""
        try:
            print(f"\n{'='*60}")
            print(f"[MessageProcessor] 📤 SENDING PLAN UPDATE (trigger: {update_trigger})")
            print(f"{'='*60}")

            # Get complete todo list with all deliverable states
            complete_todo_list = self.task_manager.get_complete_todo_list()

            # Add additional context about all deliverable states
            all_deliverable_states = self.task_manager.get_all_deliverable_states()
            if all_deliverable_states:
                complete_todo_list['all_deliverable_states'] = all_deliverable_states
                print(f"[MessageProcessor] - Deliverable states: {len(all_deliverable_states)} states with deliverables")

            # Add remaining steps info
            remaining_steps = self.task_manager.get_remaining_steps()
            complete_todo_list['remaining_steps_count'] = len(remaining_steps)

            # Log summary of what we're sending
            todo_list_data = complete_todo_list.get('todo_list', {})
            metadata = complete_todo_list.get('metadata', {})

            print(f"[MessageProcessor] PLAN UPDATE SUMMARY:")
            print(f"  - Total states: {todo_list_data.get('total_states', 0)}")
            print(f"  - Current state index: {todo_list_data.get('current_state_index', 0)}")
            print(f"  - Completed states: {todo_list_data.get('completed_states', 0)}")
            print(f"  - Progress: {todo_list_data.get('progress_percentage', 0):.1f}%")
            print(f"  - Current state: {todo_list_data.get('current_state', {}).get('title', 'None')}")
            print(f"  - Architecture: {metadata.get('architecture', 'unknown')}")
            print(f"  - States count: {metadata.get('states_count', 0)}")
            print(f"  - Tasks count: {metadata.get('tasks_count', 0)}")
            print(f"  - Deliverables count: {metadata.get('deliverables_count', 0)}")
            print(f"  - Remaining steps: {len(remaining_steps)}")

            success = await self.stream_service.send_complete_todo_list(
                todo_list_data=complete_todo_list,
                update_trigger=update_trigger
            )

            if success:
                print(f"[MessageProcessor] ✅ Successfully sent plan update to frontend")
            else:
                print(f"[MessageProcessor] ❌ Failed to send plan update to frontend")

            print(f"{'='*60}\n")

            # Also send plan progress update if using state machine
            if success and self.task_manager.is_state_machine_mode():
                plan_summary = self.task_manager.get_progress_summary()
                session_id = complete_todo_list["conversation_id"]

                # Format progress data for frontend expectations (with null safety)
                current_state = plan_summary.get("current_state", {})
                progress_info = plan_summary.get("progress", {})

                frontend_progress = {
                    "percentage": progress_info.get("percentage", 0),
                    "state": current_state.get("title", "Unknown State"),
                    "mode": current_state.get("type", "unknown"),
                    "state_id": current_state.get("id"),
                    "description": current_state.get("description", ""),
                    "total_states": progress_info.get("total_states", 0),
                    "completed_states": progress_info.get("completed_states", 0),
                    "current_state_index": progress_info.get("current_state_index", 0)
                }

                await self.stream_service.send_plan_progress_update(
                    session_id=session_id,
                    progress=frontend_progress,
                    current_step=plan_summary["current_state"],  # Use current_state from state machine
                    deliverables=plan_summary["deliverables"],
                    participant_id="plan-service",
                    stream_id="plan-progress-stream"
                )

                # Send plan completion notification if plan is completed
                if plan_summary["is_completed"] and not hasattr(self, '_plan_completion_sent'):
                    await self.stream_service.send_plan_completed(
                        session_id=session_id,
                        plan_id=plan_summary["plan_id"],
                        plan_title=plan_summary["plan_title"],
                        deliverables=plan_summary["deliverables"],
                        completion_time=plan_summary["completed_at"],
                        participant_id="plan-service",
                        stream_id="plan-completion-stream"
                    )
                    self._plan_completion_sent = True
                    print(f"[MessageProcessor] Plan completed: {plan_summary['plan_title']}")

            return success
        except Exception as e:
            print(f"[MessageProcessor] Error sending complete todo list update: {e}")
            return False

    async def _handle_silent_response_completion(self):
        """Handle completion of AI response when voice narration is disabled."""
        try:
            if self.audio_transcription:
                await self.audio_transcription.on_silent_response_completion()
        except Exception as e:
            print(f"[MessageProcessor] Error handling silent response completion: {e}")
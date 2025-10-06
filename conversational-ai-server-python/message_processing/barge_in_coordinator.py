"""
BargeIn Coordinator - Manages intelligent interruption handling during TTS playback.

This module provides:
1. Detection of user speech during TTS playback
2. Intelligent validation of interruptions using LLM
3. Decision making for resume vs abandon scenarios
4. State management for interrupted messages
"""

import asyncio
import time
import uuid
from typing import Optional, Dict, Any, Callable
from enum import Enum
from dataclasses import dataclass


class BargeInStatus(Enum):
    """Status of barge-in processing."""
    IDLE = "idle"
    SPEECH_DETECTED = "speech_detected"
    TRANSCRIBING = "transcribing"
    VALIDATING = "validating"
    VALID_INTERRUPTION = "valid_interruption"
    INVALID_INTERRUPTION = "invalid_interruption"
    RESUMING = "resuming"
    ABANDONING = "abandoning"


@dataclass
class BargeInState:
    """State information for an active barge-in scenario."""
    interruption_id: str
    interrupted_message_id: Optional[str]
    pause_timestamp: float
    speech_detection_timestamp: float
    tts_resume_data: Optional[Dict[str, Any]]
    transcribed_text: str = ""
    validation_result: Optional[bool] = None
    status: BargeInStatus = BargeInStatus.SPEECH_DETECTED

    def get_interruption_duration(self) -> float:
        """Get how long the interruption has been active."""
        return time.time() - self.speech_detection_timestamp


class BargeInCoordinator:
    """
    Coordinates barge-in functionality between audio transcription and TTS services.

    Handles the complete barge-in workflow:
    1. Speech detection during TTS playback
    2. TTS pause and transcription capture
    3. LLM-based validation of interruption intent
    4. Decision making and execution (resume/abandon)
    """

    def __init__(self, stream_service, llm_service, on_barge_in_event: Optional[Callable] = None):
        self.stream_service = stream_service
        self.llm_service = llm_service
        self.on_barge_in_event = on_barge_in_event

        # Current barge-in state
        self.current_barge_in: Optional[BargeInState] = None
        self.barge_in_lock = asyncio.Lock()

        # Configuration parameters
        self.validation_timeout = 2.0  # 2 seconds for LLM validation
        self.auto_resume_timeout = 4.0  # 4 seconds auto-resume if no valid interruption
        self.min_interruption_words = 2  # Minimum words to consider for validation
        self.speech_onset_threshold = 0.15  # 150ms for immediate speech detection

        # Statistics
        self.total_barge_ins = 0
        self.valid_interruptions = 0
        self.invalid_interruptions = 0

    async def handle_speech_during_tts(
        self,
        tts_service,
        audio_transcription_service,
        interrupted_message_id: Optional[str] = None
    ) -> str:
        """
        Handle speech detection during TTS playback.

        Returns:
            str: The interruption ID for tracking this barge-in event
        """
        async with self.barge_in_lock:
            # If already handling a barge-in, ignore new detections
            if self.current_barge_in is not None:
                print("[BargeInCoordinator] Already handling barge-in, ignoring new detection")
                return self.current_barge_in.interruption_id

            interruption_id = f"barge_in_{uuid.uuid4().hex[:8]}"
            current_time = time.time()

            print(f"[BargeInCoordinator] Speech detected during TTS - initiating barge-in {interruption_id}")

            # Create barge-in state
            self.current_barge_in = BargeInState(
                interruption_id=interruption_id,
                interrupted_message_id=interrupted_message_id,
                pause_timestamp=current_time,
                speech_detection_timestamp=current_time,
                tts_resume_data=None,
                status=BargeInStatus.SPEECH_DETECTED
            )

            try:
                # Step 1: Pause TTS and capture resume state
                print(f"[BargeInCoordinator] Pausing TTS for barge-in {interruption_id}")
                tts_resume_data = await tts_service.pause_for_barge_in()
                self.current_barge_in.tts_resume_data = tts_resume_data
                self.current_barge_in.status = BargeInStatus.TRANSCRIBING

                # Step 2: Notify frontend of barge-in detection
                await self._notify_barge_in_event("speech_detected", {
                    "interruption_id": interruption_id,
                    "interrupted_message_id": interrupted_message_id,
                    "timestamp": current_time
                })

                # Step 3: Set up auto-resume timeout
                asyncio.create_task(self._auto_resume_timeout(interruption_id))

                self.total_barge_ins += 1
                print(f"[BargeInCoordinator] Barge-in {interruption_id} setup complete")

                return interruption_id

            except Exception as e:
                print(f"[BargeInCoordinator] Error setting up barge-in {interruption_id}: {e}")
                await self._cleanup_barge_in()
                raise

    async def handle_transcription_update(self, interruption_id: str, transcribed_text: str, is_final: bool):
        """Handle transcription updates during barge-in."""
        if not self.current_barge_in or self.current_barge_in.interruption_id != interruption_id:
            return

        self.current_barge_in.transcribed_text = transcribed_text.strip()

        # Send transcription update to frontend with barge-in context
        await self._notify_barge_in_event("transcription_update", {
            "interruption_id": interruption_id,
            "text": transcribed_text,
            "is_final": is_final
        })

        # If transcription is final, trigger validation
        if is_final and transcribed_text.strip():
            await self._validate_interruption(interruption_id)

    async def _validate_interruption(self, interruption_id: str):
        """Validate whether the interruption is meaningful using LLM."""
        if not self.current_barge_in or self.current_barge_in.interruption_id != interruption_id:
            return

        transcribed_text = self.current_barge_in.transcribed_text

        # Check minimum length requirement
        word_count = len(transcribed_text.split())
        if word_count < self.min_interruption_words:
            print(f"[BargeInCoordinator] Interruption too short ({word_count} words), marking invalid")
            await self._handle_validation_result(interruption_id, False, "too_short")
            return

        print(f"[BargeInCoordinator] Validating interruption: '{transcribed_text}'")
        self.current_barge_in.status = BargeInStatus.VALIDATING

        await self._notify_barge_in_event("validation_started", {
            "interruption_id": interruption_id,
            "text": transcribed_text
        })

        try:
            # Create validation prompt
            validation_prompt = f"""Analyze this user interruption during AI speech to determine if it's a meaningful interruption or just background noise/filler.

User interruption: "{transcribed_text}"

Is this a meaningful interruption that requires stopping the AI's speech? Consider:
- Clear questions or requests
- Obvious corrections or disagreements
- Meaningful conversation continuation
- NOT: background noise, unclear sounds, very brief utterances, "um/uh" sounds

Respond with exactly "VALID" or "INVALID" followed by a brief reason."""

            # Use LLM service for validation with timeout
            validation_task = asyncio.create_task(
                self.llm_service.generate_response(validation_prompt, max_tokens=50)
            )

            try:
                response = await asyncio.wait_for(validation_task, timeout=self.validation_timeout)
                is_valid = self._parse_validation_response(response)
                reason = "llm_validated"

            except asyncio.TimeoutError:
                print(f"[BargeInCoordinator] LLM validation timeout, defaulting to valid")
                is_valid = True  # Default to valid on timeout to be permissive
                reason = "validation_timeout"

        except Exception as e:
            print(f"[BargeInCoordinator] LLM validation error: {e}, defaulting to valid")
            is_valid = True  # Default to valid on error to be permissive
            reason = "validation_error"

        await self._handle_validation_result(interruption_id, is_valid, reason)

    def _parse_validation_response(self, response: str) -> bool:
        """Parse LLM validation response."""
        if not response:
            return True  # Default to valid

        response_upper = response.upper().strip()

        # Look for explicit valid/invalid indicators
        if "VALID" in response_upper and "INVALID" not in response_upper:
            return True
        elif "INVALID" in response_upper:
            return False
        else:
            # If unclear, default to valid to be permissive
            return True

    async def _handle_validation_result(self, interruption_id: str, is_valid: bool, reason: str):
        """Handle the result of interruption validation."""
        if not self.current_barge_in or self.current_barge_in.interruption_id != interruption_id:
            return

        self.current_barge_in.validation_result = is_valid

        if is_valid:
            self.valid_interruptions += 1
            self.current_barge_in.status = BargeInStatus.VALID_INTERRUPTION

            print(f"[BargeInCoordinator] Interruption {interruption_id} validated as VALID ({reason})")

            await self._notify_barge_in_event("interruption_valid", {
                "interruption_id": interruption_id,
                "text": self.current_barge_in.transcribed_text,
                "reason": reason
            })

            # Trigger abandon current TTS and process new message
            await self._abandon_and_process_new_message(interruption_id)

        else:
            self.invalid_interruptions += 1
            self.current_barge_in.status = BargeInStatus.INVALID_INTERRUPTION

            print(f"[BargeInCoordinator] Interruption {interruption_id} validated as INVALID ({reason})")

            await self._notify_barge_in_event("interruption_invalid", {
                "interruption_id": interruption_id,
                "text": self.current_barge_in.transcribed_text,
                "reason": reason
            })

            # Resume TTS playback
            await self._resume_tts_playback(interruption_id)

    async def _abandon_and_process_new_message(self, interruption_id: str):
        """Abandon current TTS and process the interruption as a new message."""
        if not self.current_barge_in or self.current_barge_in.interruption_id != interruption_id:
            return

        self.current_barge_in.status = BargeInStatus.ABANDONING
        transcribed_text = self.current_barge_in.transcribed_text

        print(f"[BargeInCoordinator] Abandoning TTS and processing new message: '{transcribed_text}'")

        # Notify that we're processing the new message
        await self._notify_barge_in_event("processing_new_message", {
            "interruption_id": interruption_id,
            "text": transcribed_text
        })

        # Clean up barge-in state
        await self._cleanup_barge_in()

        # Trigger callback to process new message
        if self.on_barge_in_event:
            await self.on_barge_in_event("process_new_message", {
                "text": transcribed_text,
                "interruption_id": interruption_id
            })

    async def _resume_tts_playback(self, interruption_id: str):
        """Resume TTS playback from the pause point."""
        if not self.current_barge_in or self.current_barge_in.interruption_id != interruption_id:
            return

        self.current_barge_in.status = BargeInStatus.RESUMING

        print(f"[BargeInCoordinator] Resuming TTS playback for {interruption_id}")

        await self._notify_barge_in_event("resuming_tts", {
            "interruption_id": interruption_id
        })

        # Trigger callback to resume TTS
        if self.on_barge_in_event:
            resume_data = self.current_barge_in.tts_resume_data
            await self.on_barge_in_event("resume_tts", {
                "interruption_id": interruption_id,
                "resume_data": resume_data
            })

        # Clean up barge-in state
        await self._cleanup_barge_in()

    async def _auto_resume_timeout(self, interruption_id: str):
        """Auto-resume TTS if no valid interruption is detected within timeout."""
        await asyncio.sleep(self.auto_resume_timeout)

        # Check if barge-in is still active and not validated as valid
        if (self.current_barge_in and
            self.current_barge_in.interruption_id == interruption_id and
            self.current_barge_in.validation_result != True and
            self.current_barge_in.status not in [BargeInStatus.ABANDONING, BargeInStatus.RESUMING]):

            print(f"[BargeInCoordinator] Auto-resume timeout for {interruption_id}")

            # Mark as invalid and resume
            await self._handle_validation_result(interruption_id, False, "auto_resume_timeout")

    async def _notify_barge_in_event(self, event_type: str, data: Dict[str, Any]):
        """Send barge-in event notification to frontend."""
        try:
            message = {
                "type": "barge_in_event",
                "data": {
                    "event_type": event_type,
                    "timestamp": time.time(),
                    **data
                }
            }

            await self.stream_service._send_message(message)

        except Exception as e:
            print(f"[BargeInCoordinator] Error sending barge-in notification: {e}")

    async def _cleanup_barge_in(self):
        """Clean up current barge-in state."""
        if self.current_barge_in:
            interruption_id = self.current_barge_in.interruption_id
            print(f"[BargeInCoordinator] Cleaning up barge-in {interruption_id}")

        self.current_barge_in = None

    def is_barge_in_active(self) -> bool:
        """Check if a barge-in is currently active."""
        return self.current_barge_in is not None

    def get_current_barge_in_status(self) -> Optional[BargeInStatus]:
        """Get the current barge-in status."""
        return self.current_barge_in.status if self.current_barge_in else None

    def get_statistics(self) -> Dict[str, Any]:
        """Get barge-in statistics."""
        return {
            "total_barge_ins": self.total_barge_ins,
            "valid_interruptions": self.valid_interruptions,
            "invalid_interruptions": self.invalid_interruptions,
            "success_rate": self.valid_interruptions / max(1, self.total_barge_ins),
            "current_active": self.is_barge_in_active(),
            "current_status": self.get_current_barge_in_status().value if self.get_current_barge_in_status() else None
        }

    async def force_abandon_current_barge_in(self):
        """Force abandon the current barge-in (for cleanup/reset scenarios)."""
        if self.current_barge_in:
            interruption_id = self.current_barge_in.interruption_id
            print(f"[BargeInCoordinator] Force abandoning barge-in {interruption_id}")

            await self._notify_barge_in_event("force_abandoned", {
                "interruption_id": interruption_id
            })

            await self._cleanup_barge_in()
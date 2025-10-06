"""Simplified audio transcription using sherpa-onnx - continuously listens and transcribes."""
import numpy as np
import time
import os
from typing import Optional, Callable, Any

try:
    import sherpa_onnx
except ImportError as e:
    print(f"[SimpleAudioTranscription] ERROR: sherpa-onnx not available: {e}")
    sherpa_onnx = None

from .stream_service import StreamService


class SimpleAudioTranscriptionService:
    """Simplified real-time audio transcription - no session management, just continuous processing."""

    def __init__(self, stream_service: StreamService, on_final_transcript: Optional[Callable] = None, language: str = "en"):
        self.stream_service = stream_service
        self.on_final_transcript = on_final_transcript
        self.language = language

        # Single persistent recognizer and stream
        self.recognizer = None
        self.stream = None
        self.model_ready = False

        # Simple room-level state tracking
        self.accumulated_text = ''
        self.chunk_count = 0
        self.last_activity = time.time()
        self.transcript_id = f"room_transcript_{int(time.time())}"

        # Processing state to prevent duplicates
        self.processing_endpoint = False
        self.last_final_text = ""
        self.last_final_time = 0
        self.ai_pipeline_running = False
        self.ai_pipeline_text = ""

        # TTS coordination - pause transcription while assistant is speaking
        self.assistant_speaking = False
        self.tts_service = None  # Will be set by MessageProcessor

        # Barge-in functionality - detect speech onset during TTS playback
        self.barge_in_coordinator = None  # Will be set by MessageProcessor
        self.barge_in_mode = False  # Track when system is speaking (TTS active)
        self.current_barge_in_id = None  # Track active barge-in session
        self.speech_onset_threshold = 0.15  # 150ms for immediate speech detection
        self.barge_in_detection_enabled = True

        # Periodic flushing and timeout mechanism
        self.last_buffer_flush = time.time()
        self.last_speech_activity = time.time()
        self.silence_start_time = None
        self.buffer_flush_interval = 0.5  # 500ms periodic flushing
        self.speech_timeout = 10.0  # 10 second timeout for forced endpoint
        self.silence_threshold = 0.8  # 800ms silence detection (more responsive)

        # Enhanced monitoring
        self.continuous_silence_duration = 0.0
        self.last_transcript_update = time.time()

        # Silent response mode tracking
        self.silent_response_mode = False
        self.last_silent_response = 0

        # Initialize model once
        self._initialize_model()

        # System health monitoring
        self.last_health_report = time.time()
        self.health_report_interval = 30.0  # Report every 30 seconds

        # Audio queue system for robust processing
        self.audio_queue = []  # Queue of audio chunks to process
        self.processing_queue = False
        self.queue_process_size = 320  # Process 320 samples at a time (20ms at 16kHz)
        self.queue_buffer = np.array([], dtype=np.float32)  # Working buffer for queue processing

    def _initialize_model(self):
        """Initialize sherpa-onnx with automatic model download."""
        if sherpa_onnx is None:
            print("[SimpleAudioTranscription] CRITICAL: sherpa-onnx not installed!")
            return

        print("[SimpleAudioTranscription] Initializing sherpa-onnx model...")

        # Try to download and setup a working model
        model_path = self._download_model()
        if model_path:
            self.recognizer = self._create_recognizer()
            if self.recognizer:
                self.stream = self.recognizer.create_stream()
                self.model_ready = True
                print(f"[SimpleAudioTranscription] Model ready and recognizer initialized")
            else:
                print("[SimpleAudioTranscription] FAILED to create recognizer")
        else:
            print("[SimpleAudioTranscription] FAILED to download model")

    def _download_model(self) -> Optional[str]:
        """Download model - same as before."""
        import urllib.request
        import tarfile

        try:
            # Model configuration - using an English streaming model (handles many languages reasonably)
            model_name = "sherpa-onnx-streaming-zipformer-en-2023-06-21"
            model_url = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/{model_name}.tar.bz2"

            # Setup directories
            cache_dir = os.path.expanduser("~/.cache/sherpa-onnx")
            os.makedirs(cache_dir, exist_ok=True)
            model_dir = os.path.join(cache_dir, model_name)

            # Check if model already exists
            if os.path.exists(model_dir):
                required_files = ["encoder-epoch-99-avg-1.onnx",
                            "decoder-epoch-99-avg-1.onnx",
                            "joiner-epoch-99-avg-1.onnx",
                            "tokens.txt"]

                if all(os.path.exists(os.path.join(model_dir, f)) for f in required_files):
                    print(f"[SimpleAudioTranscription] Using existing model: {model_dir}")
                    self.model_path = model_dir
                    return model_dir
                else:
                    print(f"[SimpleAudioTranscription] Model directory exists but incomplete, cleaning up: {model_dir}")
                    import shutil
                    shutil.rmtree(model_dir)

            print(f"[SimpleAudioTranscription] Downloading model: {model_name}")

            # Download model
            archive_path = os.path.join(cache_dir, f"{model_name}.tar.bz2")
            urllib.request.urlretrieve(model_url, archive_path)
            print("[SimpleAudioTranscription] Download completed, extracting...")

            # Extract model
            with tarfile.open(archive_path, 'r:bz2') as tar:
                tar.extractall(cache_dir)

            # Clean up archive
            os.remove(archive_path)

            self.model_path = model_dir
            print(f"[SimpleAudioTranscription] Model extracted to: {model_dir}")
            return model_dir

        except Exception as e:
            print(f"[SimpleAudioTranscription] Model download failed: {e}")
            return None

    def _create_recognizer(self):
        """Create a new sherpa-onnx recognizer instance."""
        if not hasattr(self, 'model_path'):
            print("[SimpleAudioTranscription] ERROR: Model not ready")
            return None

        try:
            model_dir = self.model_path

            encoder_path = os.path.join(model_dir, "encoder-epoch-99-avg-1.onnx")
            decoder_path = os.path.join(model_dir, "decoder-epoch-99-avg-1.onnx")
            joiner_path = os.path.join(model_dir, "joiner-epoch-99-avg-1.onnx")
            tokens_path = os.path.join(model_dir, "tokens.txt")

            # Verify all files exist
            for path in [encoder_path, decoder_path, joiner_path, tokens_path]:
                if not os.path.exists(path):
                    print(f"[SimpleAudioTranscription] Missing model file: {path}")
                    return None

            # Create streaming recognizer with responsive VAD settings - optimized for real-time transcription
            recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
                encoder=encoder_path,
                decoder=decoder_path,
                joiner=joiner_path,
                tokens=tokens_path,
                sample_rate=16000,
                num_threads=2,
                enable_endpoint_detection=True,
                rule1_min_trailing_silence=0.8,   # Responsive endpoint detection - natural pause
                rule2_min_trailing_silence=0.6,   # Quick pauses and breathing
                rule3_min_utterance_length=200,   # Lower threshold for shorter phrases
                decoding_method="greedy_search",
                max_active_paths=4
            )

            print("[SimpleAudioTranscription] Created sherpa-onnx recognizer successfully")
            return recognizer

        except Exception as e:
            print(f"[SimpleAudioTranscription] Failed to create recognizer: {e}")
            return None

    async def process_audio_chunk(self, audio_data, room_id: str = "room"):
        """Process a single audio chunk with enhanced real-time transcription."""
        # Skip transcription while assistant is speaking
        if self.assistant_speaking:
            return

        if not self.model_ready or not self.recognizer or not self.stream:
            print("[SimpleAudioTranscription] Model not ready")
            return

        current_time = time.time()
        self.last_activity = current_time
        self.chunk_count += 1

        # Debug every 50th chunk
        debug_this_chunk = (self.chunk_count % 50 == 1)

        try:
            # Convert audio data
            if len(audio_data) == 0:
                await self._handle_silence_chunk(room_id, current_time)
                return

            # Convert bytes to float32 audio array with validation
            byte_array = np.array(audio_data, dtype=np.uint8)

            # Validate minimum audio chunk size
            if len(byte_array) < 2:
                if debug_this_chunk:
                    print(f"[SimpleAudioTranscription] Chunk too small: {len(byte_array)} bytes")
                return

            # Ensure even number of bytes for int16 conversion
            if len(byte_array) % 2 != 0:
                byte_array = np.append(byte_array, 0)

            # Convert to int16 then float32 with error handling
            try:
                audio_int16 = byte_array.view(np.int16)
                audio_array = audio_int16.astype(np.float32) / 32768.0

                # Validate audio array
                if len(audio_array) == 0:
                    return

                audio_rms = np.sqrt(np.mean(audio_array**2))

                # Sanity check for audio values
                if not np.isfinite(audio_rms) or audio_rms > 10.0:
                    if debug_this_chunk:
                        print(f"[SimpleAudioTranscription] Invalid audio RMS: {audio_rms}")
                    return

            except Exception as audio_error:
                print(f"[SimpleAudioTranscription] Audio conversion error: {audio_error}")
                return

            # Determine if this is speech or silence
            is_speech = audio_rms > 0.001

            # Apply gain normalization if needed
            if is_speech:
                target_rms = 0.15
                if audio_rms > 0.005 and audio_rms < 0.05:
                    gain = min(3.0, target_rms / audio_rms)
                    audio_array *= gain

                # Reset silence tracking when speech is detected
                self.silence_start_time = None
                self.last_speech_activity = current_time
                self.continuous_silence_duration = 0.0

                # Check for barge-in detection during TTS playback
                await self._check_barge_in_detection(current_time, audio_rms, room_id)

            # Always add audio to queue (speech or silence)
            self.audio_queue.append({
                'audio': audio_array,
                'timestamp': current_time,
                'is_speech': is_speech,
                'rms': audio_rms
            })

            # Process the audio queue
            await self._process_audio_queue(room_id, current_time, debug_this_chunk)

            # Handle silence tracking
            if not is_speech:
                await self._handle_silence_chunk(room_id, current_time)

            # Check for periodic buffer flush (every 500ms)
            if current_time - self.last_buffer_flush > self.buffer_flush_interval:
                await self._periodic_buffer_flush(room_id, current_time)

            # Check for speech timeout (force endpoint after 10 seconds)
            if current_time - self.last_speech_activity > self.speech_timeout:
                if self.accumulated_text.strip():
                    print(f"[SimpleAudioTranscription] Speech timeout - forcing endpoint after {self.speech_timeout}s")
                    await self._handle_speech_end(room_id, reason="timeout")

            # Check for VAD endpoint - but only if we have meaningful content
            is_endpoint = self.recognizer.is_endpoint(self.stream)
            if is_endpoint and self.accumulated_text.strip():
                print(f"[SimpleAudioTranscription] VAD detected speech endpoint. Text: '{self.accumulated_text}', RMS: {audio_rms:.6f}")
                await self._handle_speech_end(room_id, reason="VAD_endpoint")
            elif is_endpoint:
                # Don't trigger endpoint on empty text - reduce logging in silent response mode
                if debug_this_chunk and not self._should_suppress_vad_logging(current_time):
                    print(f"[SimpleAudioTranscription] VAD endpoint ignored - no accumulated text (RMS: {audio_rms:.6f})")

            # Periodic health monitoring
            if current_time - self.last_health_report > self.health_report_interval:
                await self._report_system_health(current_time)

        except Exception as e:
            import traceback
            print(f"[SimpleAudioTranscription] Audio processing error: {e}")
            print(f"[SimpleAudioTranscription] Traceback: {traceback.format_exc()}")

    async def _process_audio_queue(self, room_id: str, current_time: float, debug_this_chunk: bool):
        """Process audio queue in optimal chunks for sherpa-onnx."""
        if self.processing_queue:
            return  # Avoid recursive processing

        try:
            self.processing_queue = True

            # Process all queued audio chunks
            while self.audio_queue:
                chunk_data = self.audio_queue.pop(0)
                audio_chunk = chunk_data['audio']

                # Skip invalid or tiny chunks
                if len(audio_chunk) < 10:
                    continue

                # Add to working buffer
                self.queue_buffer = np.concatenate([self.queue_buffer, audio_chunk])

                # Process buffer in optimal sized chunks
                while len(self.queue_buffer) >= self.queue_process_size:
                    # Extract optimal chunk
                    process_chunk = self.queue_buffer[:self.queue_process_size]
                    self.queue_buffer = self.queue_buffer[self.queue_process_size:]

                    # Feed to sherpa-onnx
                    await self._safe_feed_to_recognizer(process_chunk, room_id, current_time, debug_this_chunk)

            # If we have a partial buffer and it's been a while, process it
            if len(self.queue_buffer) > 0:
                silence_duration = current_time - self.last_speech_activity
                if silence_duration > 0.2:  # 200ms timeout for partial buffers
                    await self._safe_feed_to_recognizer(self.queue_buffer, room_id, current_time, debug_this_chunk)
                    self.queue_buffer = np.array([], dtype=np.float32)

        except Exception as e:
            print(f"[SimpleAudioTranscription] Audio queue processing error: {e}")
        finally:
            self.processing_queue = False

    async def _safe_feed_to_recognizer(self, audio_chunk: np.ndarray, room_id: str, current_time: float, debug_this_chunk: bool):
        """Safely feed a properly sized audio chunk to sherpa-onnx."""
        try:
            if len(audio_chunk) > 0 and np.all(np.isfinite(audio_chunk)):
                # Feed to recognizer
                self.stream.accept_waveform(sample_rate=16000, waveform=audio_chunk)

                # Decode when recognizer is ready
                if self.recognizer.is_ready(self.stream):
                    self.recognizer.decode_stream(self.stream)

                # Get results
                await self._process_transcript_results(room_id, current_time, debug_this_chunk, 0.0)

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error feeding to recognizer: {e}")

    async def _flush_audio_queue(self, room_id: str, current_time: float):
        """Flush all remaining audio in queue and buffer before endpoint."""
        try:
            print(f"[SimpleAudioTranscription] Flushing audio queue: {len(self.audio_queue)} chunks, buffer: {len(self.queue_buffer)} samples")

            # Process all remaining queued audio
            await self._process_audio_queue(room_id, current_time, True)

            # If there's still content in the buffer, process it
            if len(self.queue_buffer) > 0:
                await self._safe_feed_to_recognizer(self.queue_buffer, room_id, current_time, True)
                self.queue_buffer = np.array([], dtype=np.float32)

            # Final decode to get any remaining content
            if self.recognizer and self.stream:
                try:
                    if self.recognizer.is_ready(self.stream):
                        self.recognizer.decode_stream(self.stream)
                        result = self.recognizer.get_result(self.stream)
                        if result and result.strip():
                            new_text = result.strip().capitalize()
                            if new_text != self.accumulated_text:
                                self.accumulated_text = new_text
                                print(f"[SimpleAudioTranscription] Queue flush revealed: '{new_text}'")
                except Exception as flush_error:
                    print(f"[SimpleAudioTranscription] Queue flush decode error: {flush_error}")

        except Exception as e:
            print(f"[SimpleAudioTranscription] Queue flush error: {e}")

    async def _handle_silence_chunk(self, room_id: str, current_time: float):
        """Handle silence detection and timing."""
        if self.silence_start_time is None:
            self.silence_start_time = current_time

        self.continuous_silence_duration = current_time - self.silence_start_time

        # Check if silence threshold exceeded - but only with meaningful content
        if self.continuous_silence_duration > self.silence_threshold:
            if self.accumulated_text.strip() and len(self.accumulated_text.strip()) > 3:
                print(f"[SimpleAudioTranscription] Silence threshold ({self.silence_threshold}s) exceeded - triggering endpoint")
                await self._handle_speech_end(room_id, reason="silence_threshold")

    async def _process_transcript_results(self, room_id: str, current_time: float, debug_this_chunk: bool, audio_rms: float):
        """Process and send transcript results."""
        result = self.recognizer.get_result(self.stream)
        current_text = ""

        if result and result.strip():
            current_text = result.strip().capitalize()
            if current_text != self.accumulated_text:
                self.accumulated_text = current_text
                self.last_transcript_update = current_time

                if debug_this_chunk or len(current_text) > 0:
                    print(f"[SimpleAudioTranscription] Real-time: '{current_text}' (RMS: {audio_rms:.4f})")

                # Send partial transcript immediately
                await self.stream_service.send_transcript_chunk(
                    text=current_text,
                    is_final=False,
                    participant_id=room_id,
                    transcript_id=self.transcript_id,
                    confidence=0.8
                )

    async def _periodic_buffer_flush(self, room_id: str, current_time: float):
        """Conservative periodic check - only decode when recognizer is ready."""
        self.last_buffer_flush = current_time

        # Only attempt gentle flushing when recognizer says it's ready
        if self.recognizer and self.stream and self.recognizer.is_ready(self.stream):
            try:
                self.recognizer.decode_stream(self.stream)

                # Check for any new content
                result = self.recognizer.get_result(self.stream)
                if result and result.strip():
                    new_text = result.strip().capitalize()
                    if new_text != self.accumulated_text:
                        self.accumulated_text = new_text

                        # Reset silent response mode when new speech is detected
                        if self.silent_response_mode:
                            self.silent_response_mode = False
                            print(f"[SimpleAudioTranscription] New speech detected - exiting silent response mode")

                        print(f"[SimpleAudioTranscription] Periodic check revealed: '{new_text}'")

                        # Send updated partial transcript
                        await self.stream_service.send_transcript_chunk(
                            text=new_text,
                            is_final=False,
                            participant_id=room_id,
                            transcript_id=self.transcript_id,
                            confidence=0.8
                        )
            except Exception as flush_error:
                # Don't crash on flush errors, just log them
                print(f"[SimpleAudioTranscription] Periodic check error (ignored): {flush_error}")

    async def _handle_speech_end(self, room_id: str = "room", reason: str = "VAD_endpoint"):
        """Handle detected speech endpoint - send final transcript and reset."""
        try:
            # Prevent duplicate endpoint processing
            if self.processing_endpoint:
                print(f"[SimpleAudioTranscription] Already processing endpoint, skipping duplicate")
                return

            final_text = self.accumulated_text.strip()
            current_time = time.time()
            silence_duration = current_time - self.last_activity

            print(f"[SimpleAudioTranscription] Processing speech endpoint ({reason}) after {silence_duration:.2f}s silence. Text: '{final_text}'")

            # Check for duplicate final text within longer time window to prevent rapid-fire processing
            if (final_text == self.last_final_text and
                current_time - self.last_final_time < 5.0):  # 5 second window for better duplicate prevention
                print(f"[SimpleAudioTranscription] Duplicate final text detected within 5s, skipping: '{final_text}'")
                return

            # Check if AI pipeline is already processing this exact text
            if self.ai_pipeline_running and self.ai_pipeline_text == final_text:
                print(f"[SimpleAudioTranscription] AI pipeline already processing this text, skipping: '{final_text}'")
                return

            if final_text:
                self.processing_endpoint = True
                print(f"[SimpleAudioTranscription] Speech endpoint confirmed - Final: '{final_text}' (silence: {silence_duration:.2f}s)")

                # Flush remaining audio queue and buffer before endpoint
                await self._flush_audio_queue(room_id, current_time)

                # Use comprehensive buffer flush to ensure no audio data is lost
                final_text = self._flush_recognizer_buffers(reason)

                # Send final transcript
                await self.stream_service.send_transcript_chunk(
                    text=final_text,
                    is_final=True,
                    participant_id=room_id,  # Room-level transcript
                    transcript_id=self.transcript_id,
                    confidence=0.9
                )

                # Update duplicate prevention tracking
                self.last_final_text = final_text
                self.last_final_time = current_time

                # Trigger AI processing using barge-in aware handler
                if self.on_final_transcript:
                    print(f"[SimpleAudioTranscription] Triggering AI pipeline")
                    self.ai_pipeline_running = True
                    self.ai_pipeline_text = final_text
                    try:
                        # Use barge-in aware transcription handler
                        await self.handle_transcribed_text_with_barge_in(final_text, room_id)
                        print(f"[SimpleAudioTranscription] AI pipeline completed successfully")
                    except Exception as ai_error:
                        print(f"[SimpleAudioTranscription] AI pipeline failed: {ai_error}")
                    finally:
                        self.ai_pipeline_running = False
                        self.ai_pipeline_text = ""

        except Exception as e:
            print(f"[SimpleAudioTranscription] Speech end handling error: {e}")
        finally:
            # Reset for next speech segment AFTER all processing is complete
            # This prevents stream reset from interfering with final transcription
            self._reset_for_next_utterance()
            self.processing_endpoint = False

    def _flush_recognizer_buffers(self, reason: str = "endpoint") -> str:
        """Comprehensive buffer flush to ensure no audio data is lost."""
        try:
            if not self.recognizer or not self.stream:
                return self.accumulated_text

            original_text = self.accumulated_text
            print(f"[SimpleAudioTranscription] Flushing buffers ({reason}): original='{original_text}'")

            # Step 1: Multiple decode attempts to extract all buffered content
            max_decode_attempts = 5
            best_result = self.accumulated_text

            for attempt in range(max_decode_attempts):
                try:
                    # Decode if recognizer is ready
                    if self.recognizer.is_ready(self.stream):
                        self.recognizer.decode_stream(self.stream)

                    # Get current result
                    current_result = self.recognizer.get_result(self.stream)
                    if current_result and current_result.strip():
                        current_text = current_result.strip().capitalize()
                        if len(current_text) > len(best_result):
                            best_result = current_text
                            print(f"[SimpleAudioTranscription] Decode attempt {attempt + 1}: '{current_text}'")
                        elif current_text != best_result and len(current_text) >= len(best_result) - 2:
                            # Accept if very similar length (might be better punctuation/capitalization)
                            best_result = current_text
                            print(f"[SimpleAudioTranscription] Decode attempt {attempt + 1} (refined): '{current_text}'")

                    # If no improvement for 2 consecutive attempts, we're done
                    if attempt > 1 and current_result == best_result:
                        break

                except Exception as decode_error:
                    print(f"[SimpleAudioTranscription] Decode attempt {attempt + 1} failed: {decode_error}")
                    continue

            # Update accumulated text with best result
            if best_result != original_text:
                self.accumulated_text = best_result
                print(f"[SimpleAudioTranscription] Buffer flush complete: '{original_text}' -> '{best_result}'")
            else:
                print(f"[SimpleAudioTranscription] Buffer flush confirmed: '{best_result}'")

            return self.accumulated_text

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error in buffer flush: {e}")
            return self.accumulated_text

    def _reset_for_next_utterance(self):
        """Reset state for the next utterance (but keep session alive)."""
        try:
            current_time = time.time()

            # Reset recognizer stream for next utterance
            if self.recognizer:
                self.stream = self.recognizer.create_stream()

            # Reset accumulated text and generate new transcript ID
            self.accumulated_text = ''
            self.transcript_id = f"room_transcript_{int(time.time())}_{self.chunk_count}"

            # Reset processing state (but keep duplicate prevention tracking)
            self.processing_endpoint = False
            # Note: Don't reset ai_pipeline flags here as they're managed by the pipeline itself

            # Reset timing and silence tracking
            self.last_buffer_flush = current_time
            self.last_speech_activity = current_time
            self.silence_start_time = None
            self.continuous_silence_duration = 0.0
            self.last_transcript_update = current_time

            # Clear audio queue and buffer
            self.audio_queue.clear()
            self.queue_buffer = np.array([], dtype=np.float32)
            self.processing_queue = False

            print("[SimpleAudioTranscription] Reset for next utterance (session stays alive)")

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error during reset: {e}")

    async def handle_mute_signal(self, room_id: str = "room"):
        """Handle explicit mute signal from frontend - force VAD endpoint."""
        try:
            print(f"[SimpleAudioTranscription] Received mute signal - forcing speech endpoint")

            # Prevent duplicate processing
            if self.processing_endpoint:
                print(f"[SimpleAudioTranscription] Already processing endpoint from mute, skipping")
                return

            final_text = self.accumulated_text.strip()
            current_time = time.time()

            # Check for duplicate final text within longer time window to prevent rapid-fire processing
            if (final_text == self.last_final_text and
                current_time - self.last_final_time < 5.0):  # 5 second window for better duplicate prevention
                print(f"[SimpleAudioTranscription] Mute signal: duplicate final text detected within 5s, skipping: '{final_text}'")
                return

            # Check if AI pipeline is already processing this exact text
            if self.ai_pipeline_running and self.ai_pipeline_text == final_text:
                print(f"[SimpleAudioTranscription] Mute signal: AI pipeline already processing this text, skipping: '{final_text}'")
                return

            # If we have accumulated text, send it as final before resetting
            if final_text:
                self.processing_endpoint = True
                print(f"[SimpleAudioTranscription] Mute triggered final transcript: '{final_text}'")

                # Flush remaining audio queue and buffer before endpoint
                await self._flush_audio_queue(room_id, current_time)

                # Use comprehensive buffer flush to ensure no audio data is lost
                final_text = self._flush_recognizer_buffers("mute_signal")

                # Send final transcript
                await self.stream_service.send_transcript_chunk(
                    text=final_text,
                    is_final=True,
                    participant_id=room_id,
                    transcript_id=self.transcript_id,
                    confidence=0.9
                )

                # Update duplicate prevention tracking
                self.last_final_text = final_text
                self.last_final_time = current_time

                # Trigger AI processing using barge-in aware handler
                if self.on_final_transcript:
                    print(f"[SimpleAudioTranscription] Triggering AI pipeline from mute signal")
                    self.ai_pipeline_running = True
                    self.ai_pipeline_text = final_text
                    try:
                        # Use barge-in aware transcription handler
                        await self.handle_transcribed_text_with_barge_in(final_text, room_id)
                        print(f"[SimpleAudioTranscription] AI pipeline from mute completed successfully")
                    except Exception as ai_error:
                        print(f"[SimpleAudioTranscription] AI pipeline from mute failed: {ai_error}")
                    finally:
                        self.ai_pipeline_running = False
                        self.ai_pipeline_text = ""

            print("[SimpleAudioTranscription] Mute signal handled successfully")

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error handling mute signal: {e}")
        finally:
            # Reset for next utterance AFTER all processing is complete
            self._reset_for_next_utterance()
            self.processing_endpoint = False

    async def _report_system_health(self, current_time: float):
        """Report system health and performance metrics."""
        self.last_health_report = current_time

        time_since_last_activity = current_time - self.last_activity
        time_since_last_transcript = current_time - self.last_transcript_update
        time_since_last_speech = current_time - self.last_speech_activity

        print(f"[SimpleAudioTranscription] HEALTH REPORT:")
        print(f"  - Chunks processed: {self.chunk_count}")
        print(f"  - Current transcript: '{self.accumulated_text[:50]}{'...' if len(self.accumulated_text) > 50 else ''}'")
        print(f"  - Audio queue: {len(self.audio_queue)} chunks, buffer: {len(self.queue_buffer)} samples")
        print(f"  - Time since last activity: {time_since_last_activity:.1f}s")
        print(f"  - Time since last transcript update: {time_since_last_transcript:.1f}s")
        print(f"  - Time since last speech: {time_since_last_speech:.1f}s")
        print(f"  - Continuous silence: {self.continuous_silence_duration:.1f}s")
        print(f"  - Processing endpoint: {self.processing_endpoint}")
        print(f"  - Model ready: {self.model_ready}")

    def set_tts_service(self, tts_service):
        """Set TTS service reference for voice activity coordination."""
        self.tts_service = tts_service
        print("[SimpleAudioTranscription] TTS service reference set")

    async def on_assistant_speaking_change(self, is_speaking: bool):
        """Handle assistant speaking state change for voice activity management."""
        try:
            self.assistant_speaking = is_speaking
            # Update barge-in mode based on TTS speaking state
            self.barge_in_mode = is_speaking

            if is_speaking:
                print("[SimpleAudioTranscription] Assistant started speaking - enabling barge-in detection")
                # Reset any active barge-in when new TTS starts
                if self.current_barge_in_id:
                    await self._reset_barge_in_state()
            else:
                print("[SimpleAudioTranscription] Assistant stopped speaking - disabling barge-in detection")
                # Clean up barge-in state when TTS stops
                if self.current_barge_in_id:
                    await self._reset_barge_in_state()

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error handling speaking state change: {e}")

    def set_barge_in_coordinator(self, barge_in_coordinator):
        """Set barge-in coordinator reference."""
        self.barge_in_coordinator = barge_in_coordinator
        print("[SimpleAudioTranscription] Barge-in coordinator reference set")

    async def on_silent_response_completion(self):
        """Handle completion of AI response without TTS (silent response)."""
        try:
            print("[SimpleAudioTranscription] Silent response completed - resetting VAD state")

            # Reset conversation turn state similar to what happens when TTS stops
            self.ai_pipeline_running = False
            self.ai_pipeline_text = ""

            # Clean up any accumulated text that should be processed
            if self.accumulated_text.strip():
                # If we have accumulated text, it should have been processed already
                # Clear it to prevent VAD confusion
                self.accumulated_text = ''
                self.last_transcript_update = time.time()

            # Reset VAD-related timing to prevent false endpoints
            self.last_speech_activity = time.time()
            self.silence_start_time = None
            self.continuous_silence_duration = 0.0

            # Clean up any barge-in state since no TTS was active
            if self.current_barge_in_id:
                await self._reset_barge_in_state()

            # Ensure we're not in barge-in mode
            self.barge_in_mode = False
            self.assistant_speaking = False

            # Set silent response mode to reduce VAD logging temporarily
            self.silent_response_mode = True
            self.last_silent_response = time.time()

            print("[SimpleAudioTranscription] VAD state reset for silent response completion")

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error handling silent response completion: {e}")

    def _should_suppress_vad_logging(self, current_time: float) -> bool:
        """Determine if VAD endpoint logging should be suppressed."""
        # Suppress logging for 10 seconds after a silent response completion
        return (self.silent_response_mode or
                (current_time - self.last_silent_response < 10.0))

    async def _check_barge_in_detection(self, current_time: float, audio_rms: float, room_id: str):
        """Check for barge-in detection during TTS playback."""
        # Only check for barge-in if:
        # 1. Barge-in detection is enabled
        # 2. System is in barge-in mode (TTS is speaking)
        # 3. We don't already have an active barge-in
        # 4. We have a barge-in coordinator
        if (not self.barge_in_detection_enabled or
            not self.barge_in_mode or
            self.current_barge_in_id or
            not self.barge_in_coordinator):
            return

        # Check if speech is strong enough to trigger barge-in
        # Use a higher threshold than normal speech detection for more confidence
        barge_in_threshold = 0.002  # Slightly higher than normal speech threshold

        if audio_rms > barge_in_threshold:
            print(f"[SimpleAudioTranscription] Barge-in speech detected! RMS: {audio_rms:.6f}")

            try:
                # Initiate barge-in through coordinator
                self.current_barge_in_id = await self.barge_in_coordinator.handle_speech_during_tts(
                    tts_service=self.tts_service,
                    audio_transcription_service=self,
                    interrupted_message_id=None  # Could be enhanced to track message IDs
                )

                print(f"[SimpleAudioTranscription] Barge-in initiated: {self.current_barge_in_id}")

                # Switch to barge-in transcription mode
                self.assistant_speaking = False  # Allow transcription to continue for barge-in

            except Exception as e:
                print(f"[SimpleAudioTranscription] Error initiating barge-in: {e}")

    async def handle_transcribed_text_with_barge_in(self, transcribed_text: str, room_id: str = "room") -> bool:
        """Enhanced version of handle_transcribed_text that considers barge-in context."""
        try:
            # If we have an active barge-in, send transcription update to coordinator
            if self.current_barge_in_id and self.barge_in_coordinator:
                print(f"[SimpleAudioTranscription] Sending barge-in transcription update: '{transcribed_text}'")

                await self.barge_in_coordinator.handle_transcription_update(
                    interruption_id=self.current_barge_in_id,
                    transcribed_text=transcribed_text,
                    is_final=True
                )

                # Reset barge-in state after final transcription
                await self._reset_barge_in_state()
                return True
            else:
                # Normal transcription processing - use the callback to MessageProcessor
                if self.on_final_transcript:
                    return await self.on_final_transcript(transcribed_text, room_id)
                return False

        except Exception as e:
            print(f"[SimpleAudioTranscription] Error in barge-in transcription handling: {e}")
            await self._reset_barge_in_state()
            return False

    async def _reset_barge_in_state(self):
        """Reset barge-in related state variables."""
        if self.current_barge_in_id:
            print(f"[SimpleAudioTranscription] Resetting barge-in state: {self.current_barge_in_id}")
            self.current_barge_in_id = None

        # Note: Don't reset assistant_speaking here as it's managed by TTS state

    def is_barge_in_active(self) -> bool:
        """Check if barge-in is currently active."""
        return self.current_barge_in_id is not None

    def enable_barge_in_detection(self):
        """Enable barge-in detection."""
        self.barge_in_detection_enabled = True
        print("[SimpleAudioTranscription] Barge-in detection enabled")

    def disable_barge_in_detection(self):
        """Disable barge-in detection."""
        self.barge_in_detection_enabled = False
        print("[SimpleAudioTranscription] Barge-in detection disabled")

    def cleanup(self):
        """Clean up resources."""
        if self.stream:
            self.stream = None
        if self.recognizer:
            self.recognizer = None
        print("[SimpleAudioTranscription] Cleanup completed")
"""
Open Source TTS Provider implementation.

Migrated from streaming_tts_service.py with support for Edge TTS, Kokoro, and pyttsx3.
Maintains all existing functionality and quality optimizations.
"""

import asyncio
import os
import io
import time
import tempfile
from typing import Optional, Dict, Any
import numpy as np

from .base import AbstractTTSProvider, TTSCapabilities, TTSState

# Engine availability checks
try:
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False

try:
    import edge_tts
    EDGE_TTS_AVAILABLE = True
except ImportError:
    EDGE_TTS_AVAILABLE = False

try:
    import kokoro_onnx
    import soundfile as sf
    KOKORO_AVAILABLE = True
except ImportError:
    KOKORO_AVAILABLE = False

from livekit import rtc


class OpenSourceTTSProvider(AbstractTTSProvider):
    """Open source TTS provider supporting Edge TTS, Kokoro, and pyttsx3."""

    def __init__(self, room: rtc.Room, stream_service, on_speaking_state_change=None):
        super().__init__(room, stream_service, on_speaking_state_change)

        # Engine selection and state
        self.tts_engine = None
        self.tts_engine_type = None
        self.kokoro_model = None

        # Processing control
        self.stop_processing = False
        self.resume_lock = asyncio.Lock()
        self.resume_in_progress = False

        # Enhanced pause state tracking
        self.pause_state = {
            "current_sentence": "",
            "sentence_text_position": 0,
            "audio_samples_position": 0,
            "remaining_audio_data": None,
            "paused_during_synthesis": False,
            "pause_timestamp": None,
            "synthesis_complete": False
        }

    @property
    def capabilities(self) -> TTSCapabilities:
        """Get the capabilities of this TTS provider."""
        return TTSCapabilities(
            supports_streaming=True,
            supports_pause_resume=True,
            supports_barge_in=True,
            supports_voice_selection=self.tts_engine_type in ["edge_tts", "kokoro"],
            supports_ssml=self.tts_engine_type == "edge_tts",
            max_text_length=5000
        )

    @property
    def provider_name(self) -> str:
        """Get the name of this TTS provider."""
        return f"opensource-{self.tts_engine_type or 'unknown'}"

    async def initialize(self) -> bool:
        """Initialize the open source TTS engines."""
        try:
            self.state = TTSState.INITIALIZING

            # Get TTS provider preference from environment
            tts_provider = os.getenv('TTS_PROVIDER', 'auto').lower()
            print(f"[OpenSourceTTS] TTS_PROVIDER set to: {tts_provider}")

            # Determine engine priority based on TTS_PROVIDER setting
            engine_priority = []

            if tts_provider == 'kokoro':
                # Force Kokoro if requested
                if KOKORO_AVAILABLE:
                    engine_priority = ['kokoro', 'edge_tts', 'pyttsx3']
                else:
                    print("[OpenSourceTTS] WARNING: Kokoro requested but not available, using fallback")
                    engine_priority = ['edge_tts', 'pyttsx3']

            elif tts_provider == 'edge_tts':
                # Force Edge TTS if requested
                if EDGE_TTS_AVAILABLE:
                    engine_priority = ['edge_tts', 'kokoro', 'pyttsx3']
                else:
                    print("[OpenSourceTTS] WARNING: Edge TTS requested but not available, using fallback")
                    engine_priority = ['kokoro', 'pyttsx3']

            else:
                # Auto mode: Prefer Kokoro for speed (70% faster than Edge TTS)
                engine_priority = ['kokoro', 'edge_tts', 'pyttsx3']

            # Try engines in priority order
            for engine_type in engine_priority:
                if engine_type == 'kokoro' and KOKORO_AVAILABLE:
                    try:
                        print("[OpenSourceTTS] Initializing Kokoro TTS engine...")
                        if await self._initialize_kokoro():
                            self.tts_engine_type = "kokoro"
                            await self.setup_audio_track()
                            self._start_sentence_processing()
                            self.state = TTSState.IDLE
                            print("[OpenSourceTTS] ✅ Kokoro TTS engine initialized successfully (50-100ms latency)")
                            return True
                        else:
                            print("[OpenSourceTTS] Kokoro initialization failed")
                    except Exception as e:
                        print(f"[OpenSourceTTS] Kokoro TTS failed: {e}")

                elif engine_type == 'edge_tts' and EDGE_TTS_AVAILABLE:
                    try:
                        print("[OpenSourceTTS] Initializing Edge TTS engine...")
                        self.tts_engine_type = "edge_tts"
                        await self.setup_audio_track()
                        self._start_sentence_processing()
                        self.state = TTSState.IDLE
                        print("[OpenSourceTTS] ✅ Edge TTS engine initialized successfully (200-300ms latency)")
                        return True
                    except Exception as e:
                        print(f"[OpenSourceTTS] Edge TTS failed: {e}")

                elif engine_type == 'pyttsx3' and PYTTSX3_AVAILABLE:
                    try:
                        print("[OpenSourceTTS] Initializing pyttsx3 TTS engine...")
                        self.tts_engine = pyttsx3.init()
                        self.tts_engine_type = "pyttsx3"

                        # Configure pyttsx3 settings
                        rate = self.tts_engine.getProperty('rate')
                        self.tts_engine.setProperty('rate', rate - 50)

                        await self.setup_audio_track()
                        self._start_sentence_processing()
                        self.state = TTSState.IDLE
                        print("[OpenSourceTTS] ✅ pyttsx3 TTS engine initialized successfully (fallback)")
                        return True
                    except Exception as e:
                        print(f"[OpenSourceTTS] pyttsx3 TTS failed: {e}")

            # All engines failed
            print("[OpenSourceTTS] ❌ All TTS engines failed")
            self.state = TTSState.ERROR
            return False

        except Exception as e:
            print(f"[OpenSourceTTS] Initialization error: {e}")
            self.state = TTSState.ERROR
            return False

    async def _initialize_kokoro(self) -> bool:
        """Initialize Kokoro TTS engine."""
        try:
            # Check environment variables
            model_path = os.getenv('KOKORO_MODEL_PATH', './kokoro-models/kokoro-v1.0.onnx')
            voices_path = os.getenv('KOKORO_VOICES_PATH', './kokoro-models/voices-v1.0.bin')

            # Ensure models are downloaded
            if not await self._download_kokoro_models():
                return False

            # Use cache directory paths
            cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
            if cache_dir and os.path.exists(cache_dir):
                model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
                voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

            # Verify files exist
            if not os.path.exists(model_path) or not os.path.exists(voices_path):
                print(f"[OpenSourceTTS] Kokoro model files not found: {model_path}, {voices_path}")
                return False

            # Initialize Kokoro engine
            print(f"[OpenSourceTTS] Loading Kokoro model from: {model_path}")
            self.kokoro_model = kokoro_onnx.Kokoro(model_path, voices_path)
            return True

        except Exception as e:
            print(f"[OpenSourceTTS] Failed to initialize Kokoro: {e}")
            return False

    async def _download_kokoro_models(self) -> bool:
        """Download Kokoro models if they don't exist."""
        try:
            import urllib.request

            # Determine cache directory
            cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
            if not cache_dir or not os.path.exists(os.path.dirname(cache_dir)):
                cache_dir = os.path.expanduser('~/.cache/kokoro')

            os.makedirs(cache_dir, exist_ok=True)

            model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
            voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

            # Check if models already exist
            if os.path.exists(model_path) and os.path.exists(voices_path):
                print("[OpenSourceTTS] Kokoro models already exist")
                return True

            # Download model file (~300MB)
            if not os.path.exists(model_path):
                print("[OpenSourceTTS] Downloading Kokoro model (~300MB)...")
                model_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
                urllib.request.urlretrieve(model_url, model_path)
                print("[OpenSourceTTS] Kokoro model download completed")

            # Download voices file
            if not os.path.exists(voices_path):
                print("[OpenSourceTTS] Downloading Kokoro voices...")
                voices_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
                urllib.request.urlretrieve(voices_url, voices_path)
                print("[OpenSourceTTS] Kokoro voices download completed")

            return os.path.exists(model_path) and os.path.exists(voices_path)

        except Exception as e:
            print(f"[OpenSourceTTS] Failed to download Kokoro models: {e}")
            return False

    async def synthesize_sentence(self, sentence: str, voice: Optional[str] = None) -> Optional[np.ndarray]:
        """Synthesize a single sentence to audio data."""
        try:
            self.state = TTSState.SYNTHESIZING

            if self.tts_engine_type == "edge_tts":
                return await self._synthesize_with_edge_tts(sentence, voice)
            elif self.tts_engine_type == "kokoro":
                return await self._synthesize_with_kokoro(sentence, voice)
            elif self.tts_engine_type == "pyttsx3":
                return await self._synthesize_with_pyttsx3(sentence)
            else:
                print(f"[OpenSourceTTS] Unknown TTS engine type: {self.tts_engine_type}")
                return None

        except Exception as e:
            print(f"[OpenSourceTTS] Error synthesizing sentence: {e}")
            return None

    async def _synthesize_with_edge_tts(self, sentence: str, voice: Optional[str] = None) -> Optional[np.ndarray]:
        """Synthesize speech using Edge TTS."""
        try:
            # Use provided voice or default to high-quality options
            voice_options = [
                voice or "en-US-AriaNeural",
                "en-US-JennyNeural",
                "en-US-GuyNeural",
                "en-US-SaraNeural"
            ]

            for voice_id in voice_options:
                try:
                    # Create Edge TTS communication
                    communicate = edge_tts.Communicate(sentence, voice_id)

                    # Generate audio to temporary file
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                        await communicate.save(tmp_file.name)

                        # Load and process the audio file
                        audio_data = await self._load_and_process_audio_file(tmp_file.name)

                        # Clean up temp file
                        os.unlink(tmp_file.name)

                        if audio_data is not None:
                            print(f"[OpenSourceTTS] Successfully used Edge TTS voice: {voice_id}")
                            return audio_data

                except Exception as voice_error:
                    print(f"[OpenSourceTTS] Edge TTS voice '{voice_id}' failed: {voice_error}")
                    continue

            return None

        except Exception as e:
            print(f"[OpenSourceTTS] Edge TTS synthesis failed: {e}")
            return None

    async def _synthesize_with_kokoro(self, sentence: str, voice: Optional[str] = None) -> Optional[np.ndarray]:
        """Synthesize speech using Kokoro TTS."""
        try:
            if not self.kokoro_model:
                return None

            # Preferred voices in order of quality
            preferred_voices = [voice] if voice else ['af_sarah', 'af_bella', 'af_nicole', 'af_sky', 'af']

            for voice_id in preferred_voices:
                if voice_id is None:
                    continue

                try:
                    # Run synthesis in thread pool to avoid blocking
                    audio_bytes = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: self.kokoro_model.create(sentence, voice=voice_id)
                    )

                    # Process audio data
                    audio_data = await self._process_kokoro_audio(audio_bytes)
                    if audio_data is not None:
                        print(f"[OpenSourceTTS] Successfully used Kokoro voice: {voice_id}")
                        return audio_data

                except Exception as voice_error:
                    print(f"[OpenSourceTTS] Kokoro voice '{voice_id}' failed: {voice_error}")
                    continue

            # Final fallback - no voice parameter
            try:
                audio_bytes = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: self.kokoro_model.create(sentence)
                )
                return await self._process_kokoro_audio(audio_bytes)
            except Exception as e:
                print(f"[OpenSourceTTS] Kokoro default voice failed: {e}")

            return None

        except Exception as e:
            print(f"[OpenSourceTTS] Kokoro synthesis failed: {e}")
            return None

    async def _synthesize_with_pyttsx3(self, sentence: str) -> Optional[np.ndarray]:
        """Synthesize speech using pyttsx3 - basic implementation."""
        try:
            # For now, pyttsx3 is hard to capture properly for streaming
            # This is a placeholder - real implementation would need audio capture
            print(f"[OpenSourceTTS] pyttsx3 synthesis not fully implemented: {sentence}")
            return None
        except Exception as e:
            print(f"[OpenSourceTTS] pyttsx3 synthesis failed: {e}")
            return None

    async def stream_audio_data(self, audio_data: np.ndarray) -> bool:
        """Stream audio data to LiveKit with pause checking."""
        try:
            if not self.audio_source or len(audio_data) == 0:
                return False

            # Use smaller chunks for responsive pausing
            chunk_size = 480  # 30ms at 16kHz
            chunks_sent = 0

            for i in range(0, len(audio_data), chunk_size):
                chunk = audio_data[i:i + chunk_size]
                if len(chunk) < chunk_size:
                    chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

                # Convert and send chunk
                chunk_clipped = np.clip(chunk, -1.0, 1.0)
                chunk_int16 = (chunk_clipped * 32767).astype(np.int16)

                frame = rtc.AudioFrame(
                    data=chunk_int16.tobytes(),
                    sample_rate=16000,
                    num_channels=1,
                    samples_per_channel=len(chunk)
                )

                # Send with retry logic
                success = await self._send_audio_frame_with_retry(frame)
                if not success:
                    # Store pause state for potential resume
                    await self._store_pause_state_at_position(
                        self.pause_state.get("current_sentence", ""),
                        i, audio_data[i:]
                    )
                    return False

                chunks_sent += 1

                # Check for pause after sending chunk
                if self.is_paused:
                    next_audio_position = i + chunk_size
                    remaining_audio = audio_data[next_audio_position:] if next_audio_position < len(audio_data) else None
                    await self._store_pause_state_at_position(
                        self.pause_state.get("current_sentence", ""),
                        next_audio_position, remaining_audio
                    )
                    return False  # Paused mid-stream

                # Minimal delay for responsiveness
                await asyncio.sleep(0.001)

            print(f"[OpenSourceTTS] Completed streaming {chunks_sent} chunks")
            return True

        except Exception as e:
            print(f"[OpenSourceTTS] Error streaming audio data: {e}")
            return False

    async def _send_audio_frame_with_retry(self, frame: rtc.AudioFrame) -> bool:
        """Send audio frame with retry logic for InvalidState errors."""
        retry_count = 0
        max_retries = 3

        while retry_count < max_retries:
            try:
                await self.audio_source.capture_frame(frame)
                return True
            except Exception as e:
                error_msg = str(e)
                if "InvalidState" in error_msg and retry_count < max_retries - 1:
                    print(f"[OpenSourceTTS] Audio capture failed (attempt {retry_count + 1}): {error_msg}, retrying...")
                    retry_count += 1
                    await asyncio.sleep(0.05)
                else:
                    print(f"[OpenSourceTTS] Audio capture failed permanently: {error_msg}")
                    return False

        return False

    async def _store_pause_state_at_position(self, sentence: str, audio_position: int, remaining_audio: Optional[np.ndarray]):
        """Store pause state at specific audio position."""
        # Calculate text position based on audio progress
        if len(sentence) > 0 and remaining_audio is not None:
            total_audio_length = audio_position + len(remaining_audio)
            if total_audio_length > 0:
                progress_ratio = audio_position / total_audio_length
                text_position = int(progress_ratio * len(sentence))
            else:
                text_position = 0
        else:
            text_position = len(sentence)

        self.pause_state.update({
            "current_sentence": sentence,
            "sentence_text_position": text_position,
            "audio_samples_position": audio_position,
            "remaining_audio_data": remaining_audio,
            "paused_during_synthesis": True,
            "pause_timestamp": time.time(),
            "synthesis_complete": remaining_audio is None
        })

        print(f"[OpenSourceTTS] Stored pause state: audio_pos={audio_position}, text_pos={text_position}")

    def _start_sentence_processing(self):
        """Start async sentence processing task."""
        if self.processing_task is None:
            self.stop_processing = False
            self.processing_task = asyncio.create_task(self._process_sentence_queue())

    async def _process_sentence_queue(self):
        """Process sentence queue with pause support."""
        while not self.stop_processing:
            try:
                # Wait for pause to be lifted
                if self.is_paused:
                    await self.pause_event.wait()
                    if self.stop_processing:
                        break

                # Wait if resume is in progress
                while self.resume_in_progress and not self.stop_processing:
                    await asyncio.sleep(0.1)

                # Get sentence from queue
                try:
                    sentence = await asyncio.wait_for(self.sentence_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if sentence is None:  # Shutdown signal
                    break

                # Process sentence
                await self._process_single_sentence(sentence)
                self.sentence_queue.task_done()

            except Exception as e:
                print(f"[OpenSourceTTS] Error in sentence processing: {e}")

    async def _process_single_sentence(self, sentence: str):
        """Process a single sentence through synthesis and streaming."""
        try:
            # Check pause before processing
            if self.is_paused:
                self.pause_state["current_sentence"] = sentence
                return

            # Initialize pause state for this sentence
            self.pause_state.update({
                "current_sentence": sentence,
                "sentence_text_position": 0,
                "audio_samples_position": 0,
                "remaining_audio_data": None,
                "paused_during_synthesis": False,
                "pause_timestamp": None,
                "synthesis_complete": False
            })

            print(f"[OpenSourceTTS] Processing sentence: '{sentence}'")
            await self._on_audio_start()

            # Synthesize audio
            audio_data = await self.synthesize_sentence(sentence)
            if audio_data is None:
                print(f"[OpenSourceTTS] Synthesis failed for: '{sentence}'")
                await self._on_audio_stop()
                return

            # Stream audio
            completed = await self.stream_audio_data(audio_data)

            # Handle completion or pause
            if completed and not self.is_paused:
                self.pause_state["synthesis_complete"] = True
                await self._on_audio_stop()
                self._clear_pause_state()
            elif self.is_paused:
                print(f"[OpenSourceTTS] Sentence paused mid-synthesis: '{sentence}'")

        except Exception as e:
            print(f"[OpenSourceTTS] Error processing sentence: {e}")
            if not self.is_paused:
                await self._on_audio_stop()

    async def _resume_from_pause_state(self):
        """Resume from stored pause state."""
        try:
            async with self.resume_lock:
                self.resume_in_progress = True

                try:
                    current_sentence = self.pause_state.get("current_sentence", "")
                    remaining_audio = self.pause_state.get("remaining_audio_data")
                    text_position = self.pause_state.get("sentence_text_position", 0)

                    if not current_sentence:
                        return

                    print(f"[OpenSourceTTS] Resuming from pause: '{current_sentence[:30]}...'")

                    # Strategy 1: Resume from exact audio position if available
                    if remaining_audio is not None and len(remaining_audio) > 0:
                        print(f"[OpenSourceTTS] Resuming from stored audio: {len(remaining_audio)} samples")
                        completed = await self.stream_audio_data(remaining_audio)
                        if completed:
                            self._clear_pause_state()
                            await self._on_audio_stop()
                        return

                    # Strategy 2: Re-synthesize remaining text
                    if text_position < len(current_sentence):
                        remaining_text = current_sentence[text_position:].strip()
                        if remaining_text:
                            print(f"[OpenSourceTTS] Re-synthesizing remaining text: '{remaining_text[:30]}...'")
                            self._clear_pause_state()
                            await self._process_single_sentence(remaining_text)
                            return

                    # Strategy 3: Nothing to resume
                    print("[OpenSourceTTS] Nothing to resume, synthesis was complete")
                    self._clear_pause_state()

                finally:
                    self.resume_in_progress = False

        except Exception as e:
            print(f"[OpenSourceTTS] Error resuming from pause: {e}")
            self._clear_pause_state()
            self.resume_in_progress = False

    def _clear_pause_state(self):
        """Clear pause state."""
        self.pause_state = {
            "current_sentence": "",
            "sentence_text_position": 0,
            "audio_samples_position": 0,
            "remaining_audio_data": None,
            "paused_during_synthesis": False,
            "pause_timestamp": None,
            "synthesis_complete": False
        }

    async def _load_and_process_audio_file(self, audio_file_path: str) -> Optional[np.ndarray]:
        """Load and process audio file to float32 array."""
        try:
            # Try soundfile first (higher quality)
            try:
                audio_data, sample_rate = sf.read(audio_file_path, dtype='float32')
            except ImportError:
                # Fallback to pydub
                from pydub import AudioSegment
                audio = AudioSegment.from_file(audio_file_path)
                audio = audio.set_frame_rate(16000).set_channels(1)
                audio_data = np.array(audio.get_array_of_samples(), dtype=np.float32) / 32768.0
                sample_rate = 16000

            # Ensure mono
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            # Resample to 16kHz if needed
            if sample_rate != 16000:
                try:
                    import librosa
                    audio_data = librosa.resample(audio_data, orig_sr=sample_rate, target_sr=16000, res_type='kaiser_best')
                except ImportError:
                    import scipy.signal
                    audio_data = scipy.signal.resample_poly(audio_data, 16000, sample_rate)

            # Clean up audio
            audio_data = audio_data - np.mean(audio_data)  # Remove DC offset

            # Gentle normalization
            max_val = np.max(np.abs(audio_data))
            if max_val > 0.98:
                audio_data = audio_data * (0.85 / max_val)
            elif max_val < 0.1:
                audio_data = audio_data * (0.3 / max_val)

            return audio_data.astype(np.float32)

        except Exception as e:
            print(f"[OpenSourceTTS] Error loading audio file: {e}")
            return None

    async def _process_kokoro_audio(self, audio_bytes) -> Optional[np.ndarray]:
        """Process Kokoro audio data."""
        try:
            if isinstance(audio_bytes, tuple):
                raw_audio_data, kokoro_sample_rate = audio_bytes

                if isinstance(raw_audio_data, bytes):
                    audio_data = np.frombuffer(raw_audio_data, dtype=np.int16).astype(np.float32) / 32768.0
                    sample_rate = kokoro_sample_rate
                else:
                    raw_array = np.array(raw_audio_data)
                    if raw_array.dtype == np.int16:
                        audio_data = raw_array.astype(np.float32) / 32768.0
                    elif raw_array.dtype == np.int32:
                        audio_data = raw_array.astype(np.float32) / 2147483648.0
                    elif raw_array.dtype in [np.float32, np.float64]:
                        audio_data = raw_array.astype(np.float32)
                        max_val = np.max(np.abs(audio_data))
                        if max_val > 1.0:
                            audio_data = audio_data / max_val
                    else:
                        audio_data = raw_array.astype(np.float32)
                    sample_rate = kokoro_sample_rate
            else:
                # Fallback for WAV format
                audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype='float32')

            # Ensure mono
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            # Resample to 16kHz if needed
            if sample_rate != 16000:
                try:
                    import librosa
                    audio_data = librosa.resample(audio_data, orig_sr=sample_rate, target_sr=16000, res_type='kaiser_best')
                except ImportError:
                    import scipy.signal
                    audio_data = scipy.signal.resample_poly(audio_data, 16000, sample_rate)

            # Clean up audio
            audio_data = audio_data - np.mean(audio_data)

            # Gentle normalization
            max_val = np.max(np.abs(audio_data))
            if max_val > 0.98:
                audio_data = audio_data * (0.85 / max_val)
            elif max_val < 0.1:
                audio_data = audio_data * (0.3 / max_val)

            return audio_data.astype(np.float32)

        except Exception as e:
            print(f"[OpenSourceTTS] Error processing Kokoro audio: {e}")
            return None

    async def _cleanup_provider(self):
        """Provider-specific cleanup."""
        try:
            # Stop processing task
            self.stop_processing = True
            if self.processing_task and not self.processing_task.done():
                self.processing_task.cancel()
                try:
                    await self.processing_task
                except asyncio.CancelledError:
                    pass

            # Clean up TTS resources
            if self.tts_engine:
                self.tts_engine = None

            if self.kokoro_model:
                self.kokoro_model = None

            print("[OpenSourceTTS] Provider cleanup completed")

        except Exception as e:
            print(f"[OpenSourceTTS] Error during provider cleanup: {e}")
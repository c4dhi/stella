"""
Streaming Text-to-Speech service with sentence-level processing for ultra-low latency.
Processes complete sentences immediately as they arrive, minimizing time-to-first-word.
"""
import asyncio
import re
import time
import os
import io
from typing import Optional, Callable, List, Tuple
from queue import Queue as SyncQueue
from threading import Thread, Event
import numpy as np

# For now, let's implement a simple TTS system without RealtimeTTS due to Python 3.9 compatibility issues
# We'll use a basic text-to-speech approach with system TTS or a simple implementation

try:
    # Try importing system TTS libraries
    import pyttsx3
    PYTTSX3_AVAILABLE = True
except ImportError:
    PYTTSX3_AVAILABLE = False

try:
    # Try importing edge TTS (simpler alternative)
    import edge_tts
    EDGE_TTS_AVAILABLE = True
except ImportError:
    EDGE_TTS_AVAILABLE = False

try:
    # Try importing Kokoro TTS
    import kokoro_onnx
    import soundfile as sf
    KOKORO_AVAILABLE = True
except ImportError:
    KOKORO_AVAILABLE = False

# For now, disable RealtimeTTS due to Python 3.9 compatibility
REALTIMETTS_AVAILABLE = False
COQUI_AVAILABLE = False

from livekit import rtc
from .stream_service import StreamService


class StreamingTTSService:
    """Streaming TTS service with sentence-level processing for minimal latency."""

    def __init__(self, stream_service: StreamService, room: rtc.Room, on_speaking_state_change: Optional[Callable] = None):
        self.stream_service = stream_service
        self.room = room
        self.on_speaking_state_change = on_speaking_state_change

        # TTS state
        self.is_speaking = False
        self.tts_available = KOKORO_AVAILABLE or PYTTSX3_AVAILABLE or EDGE_TTS_AVAILABLE
        self.tts_engine = None
        self.tts_engine_type = None

        # Kokoro specific
        self.kokoro_model = None
        self.kokoro_voices = None

        # Async sentence processing - no threads!
        self.sentence_buffer = ""
        self.sentence_queue = asyncio.Queue()
        self.processing_task = None
        self.stop_processing = False

        # Pause/Resume functionality with concurrency control
        self.is_paused = False
        self.pause_event = asyncio.Event()
        self.pause_event.set()  # Start unpaused
        self.resume_in_progress = False
        self.resume_lock = asyncio.Lock()

        # Enhanced pause state tracking
        self.pause_state = {
            "current_sentence": "",
            "sentence_text_position": 0,  # Character position in current sentence
            "audio_samples_position": 0,  # Audio sample position in current synthesis
            "remaining_audio_data": None,  # Audio data to continue from
            "paused_during_synthesis": False,
            "pause_timestamp": None,
            "synthesis_complete": False  # Track if synthesis was complete when paused
        }

        # Message tracking to differentiate chunks vs new messages
        self.current_message_id = None
        self.current_stream_id = None

        # Initialize TTS engines
        self._initialize_tts()

        # Audio streaming buffer with proper timing
        self.audio_buffer = []
        self.buffer_lock = asyncio.Lock()
        self.stream_task = None

        # Initialize audio source attributes (will be set by _setup_audio_track)
        self.audio_source = None
        self.audio_track = None

        # Start async processing
        self._start_async_processing()

    def _initialize_tts(self):
        """Initialize TTS with available engines."""
        if not self.tts_available:
            print("[StreamingTTS] TTS not available - running in silent mode")
            return

        # Try engines in order of preference (Edge TTS first for best quality)
        if EDGE_TTS_AVAILABLE:
            try:
                print("[StreamingTTS] Initializing Edge TTS engine (cloud-based, highest quality)...")
                self.tts_engine_type = "edge_tts"
                print("[StreamingTTS] Edge TTS engine initialized successfully")
                return
            except Exception as e:
                print(f"[StreamingTTS] Edge TTS failed: {e}")

        if KOKORO_AVAILABLE:
            try:
                print("[StreamingTTS] Initializing Kokoro TTS engine (high-quality neural voices)...")
                if self._initialize_kokoro():
                    self.tts_engine_type = "kokoro"
                    print("[StreamingTTS] Kokoro TTS engine initialized successfully")
                    return
                else:
                    print("[StreamingTTS] Kokoro initialization failed - models not available")
            except Exception as e:
                print(f"[StreamingTTS] Kokoro TTS failed: {e}")

        if PYTTSX3_AVAILABLE:
            try:
                print("[StreamingTTS] Initializing pyttsx3 TTS engine (system-based)...")
                self.tts_engine = pyttsx3.init()
                self.tts_engine_type = "pyttsx3"

                # Configure pyttsx3 settings
                rate = self.tts_engine.getProperty('rate')
                self.tts_engine.setProperty('rate', rate - 50)  # Slow down slightly

                print("[StreamingTTS] pyttsx3 TTS engine initialized successfully")
                return
            except Exception as e:
                print(f"[StreamingTTS] pyttsx3 TTS failed: {e}")

        # If we get here, all engines failed
        print("[StreamingTTS] All TTS engines failed")
        self.tts_available = False

    def _initialize_kokoro(self) -> bool:
        """Initialize Kokoro TTS engine by downloading models if needed."""
        try:
            # Check environment variables
            model_path = os.getenv('KOKORO_MODEL_PATH', './kokoro-models/kokoro-v1.0.onnx')
            voices_path = os.getenv('KOKORO_VOICES_PATH', './kokoro-models/voices-v1.0.bin')

            # Ensure models are downloaded
            if not self._download_kokoro_models():
                return False

            # Use cache directory paths for Docker environment
            cache_dir = os.getenv('KOKORO_CACHE_DIR', '/root/.cache/kokoro')
            if cache_dir and os.path.exists(cache_dir):
                model_path = os.path.join(cache_dir, 'kokoro-v1.0.onnx')
                voices_path = os.path.join(cache_dir, 'voices-v1.0.bin')

            # Verify files exist
            if not os.path.exists(model_path) or not os.path.exists(voices_path):
                print(f"[TTS] Kokoro model files not found: {model_path}, {voices_path}")
                return False

            # Initialize Kokoro engine
            print(f"[TTS] Loading Kokoro model from: {model_path}")
            self.kokoro_model = kokoro_onnx.Kokoro(model_path, voices_path)
            return True

        except Exception as e:
            print(f"[TTS] Failed to initialize Kokoro: {e}")
            return False

    def _download_kokoro_models(self) -> bool:
        """Download Kokoro models if they don't exist (following sherpa-onnx pattern)."""
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
                print("[TTS] Kokoro models already exist")
                return True

            # Download model file (~300MB)
            if not os.path.exists(model_path):
                print("[TTS] Downloading Kokoro model (~300MB)...")
                model_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
                urllib.request.urlretrieve(model_url, model_path)
                print("[TTS] Kokoro model download completed")

            # Download voices file
            if not os.path.exists(voices_path):
                print("[TTS] Downloading Kokoro voices...")
                voices_url = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
                urllib.request.urlretrieve(voices_url, voices_path)
                print("[TTS] Kokoro voices download completed")

            return os.path.exists(model_path) and os.path.exists(voices_path)

        except Exception as e:
            print(f"[TTS] Failed to download Kokoro models: {e}")
            return False

    def _start_async_processing(self):
        """Start async processing tasks."""
        if self.processing_task is None:
            self.stop_processing = False
            self.processing_task = asyncio.create_task(self._async_process_sentence_queue())
            print("[StreamingTTS] Async sentence processing started")

    async def _async_process_sentence_queue(self):
        """Async processing of sentence queue with pause support."""
        while not self.stop_processing:
            try:
                # Wait for pause to be lifted if paused
                if self.is_paused:
                    print("[StreamingTTS] Queue processing paused, waiting for resume...")
                    await self.pause_event.wait()
                    if self.stop_processing:
                        break

                # Also wait if resume is in progress to prevent concurrent synthesis
                if self.resume_in_progress:
                    print("[StreamingTTS] ⏳ Resume in progress, waiting for completion...")
                    # Wait for resume to complete before processing new sentences
                    while self.resume_in_progress and not self.stop_processing:
                        await asyncio.sleep(0.1)
                    if self.stop_processing:
                        break

                # Get sentence from queue with timeout
                try:
                    sentence = await asyncio.wait_for(self.sentence_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if sentence is None:  # Shutdown signal
                    break

                # Check pause state again before processing
                if self.is_paused:
                    # Store this sentence as current and wait for resume instead of re-queuing
                    if not self.pause_state.get("current_sentence"):
                        self.pause_state.update({
                            "current_sentence": sentence,
                            "sentence_text_position": 0,
                            "audio_samples_position": 0,
                            "remaining_audio_data": None,
                            "paused_during_synthesis": False,
                            "pause_timestamp": time.time(),
                            "synthesis_complete": False
                        })
                        print(f"[StreamingTTS] 💾 Stored dequeued sentence for resume: '{sentence[:30]}...'")
                    # Mark as processed to prevent re-queuing
                    self.sentence_queue.task_done()
                    continue

                # Process the sentence asynchronously
                await self._async_synthesize_sentence(sentence)
                self.sentence_queue.task_done()

            except Exception as e:
                print(f"[StreamingTTS] Error in async sentence processing: {e}")

    async def _async_synthesize_sentence(self, sentence: str):
        """Async synthesis with immediate pause/resume support at any point."""
        if not self.tts_available:
            print(f"[StreamingTTS] TTS not available, skipping: '{sentence}'")
            return

        try:
            # Check if paused before starting synthesis
            if self.is_paused:
                print(f"[StreamingTTS] Paused before synthesis, storing sentence: '{sentence[:30]}...'")
                # Store sentence in pause state instead of re-queuing
                self.pause_state.update({
                    "current_sentence": sentence,
                    "sentence_text_position": 0,
                    "audio_samples_position": 0,
                    "remaining_audio_data": None,
                    "paused_during_synthesis": False,
                    "pause_timestamp": time.time(),
                    "synthesis_complete": False
                })
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

            print(f"[StreamingTTS] Async synthesizing sentence: '{sentence}'")

            # Call audio start callback
            await self._async_on_audio_start()

            # Check for immediate pause after audio start
            if self.is_paused:
                print(f"[StreamingTTS] Immediate pause detected, storing sentence")
                await self._store_pause_state(sentence, 0, 0, None)
                await self._async_on_audio_stop()
                return

            # Perform synthesis with pause monitoring
            if self.tts_engine_type == "edge_tts":
                await self._async_synthesize_with_edge_tts_pausable(sentence)
            elif self.tts_engine_type == "kokoro":
                await self._async_synthesize_with_kokoro_pausable(sentence)
            elif self.tts_engine_type == "pyttsx3":
                await self._async_synthesize_with_pyttsx3(sentence)
            else:
                print(f"[StreamingTTS] Unknown TTS engine type: {self.tts_engine_type}")

            # Only call stop if not paused mid-synthesis
            if not self.pause_state["paused_during_synthesis"]:
                await self._async_on_audio_stop()
                self._clear_pause_state()

        except Exception as e:
            print(f"[StreamingTTS] Error synthesizing sentence '{sentence}': {e}")
            if not self.pause_state["paused_during_synthesis"]:
                await self._async_on_audio_stop()

    def _synthesize_with_kokoro(self, sentence: str):
        """Synthesize speech using Kokoro TTS and stream to LiveKit."""
        try:
            if not self.kokoro_model:
                print("[StreamingTTS] Kokoro model not initialized")
                return

            print(f"[StreamingTTS] Kokoro synthesizing: '{sentence}'")

            # Generate audio using Kokoro with high-quality voice selection
            # Preferred voices in order of quality (natural -> robotic)
            preferred_voices = ['af_sarah', 'af_bella', 'af_nicole', 'af_sky', 'af']

            audio_bytes = None

            # Try voices in order of preference
            for voice in preferred_voices:
                try:
                    print(f"[StreamingTTS] Trying voice: {voice}")
                    audio_bytes = self.kokoro_model.create(sentence, voice=voice)
                    print(f"[StreamingTTS] Successfully using voice: {voice}")
                    break
                except Exception as voice_error:
                    print(f"[StreamingTTS] Voice '{voice}' failed: {voice_error}")
                    continue

            # Final fallback - no voice parameter
            if audio_bytes is None:
                try:
                    print("[StreamingTTS] All preferred voices failed, trying default voice")
                    audio_bytes = self.kokoro_model.create(sentence)
                except Exception as e:
                    print(f"[StreamingTTS] Default voice also failed: {e}")
                    return

            # Handle Kokoro's create() method return format
            # Kokoro returns (raw_pcm_data, sample_rate) tuple - not WAV format!
            if isinstance(audio_bytes, tuple):
                # Kokoro returned (raw_pcm_data, sample_rate) tuple
                raw_audio_data, kokoro_sample_rate = audio_bytes
                print(f"[StreamingTTS] Kokoro returned raw PCM data: sample_rate={kokoro_sample_rate}, data_type={type(raw_audio_data)}")

                # Convert raw PCM data to numpy array
                if isinstance(raw_audio_data, bytes):
                    # Raw PCM bytes - convert to float32 array
                    # Assume 16-bit PCM (most common)
                    audio_data = np.frombuffer(raw_audio_data, dtype=np.int16).astype(np.float32) / 32768.0
                    sample_rate = kokoro_sample_rate
                else:
                    # Already numpy array - check its dtype and normalize properly
                    raw_array = np.array(raw_audio_data)
                    print(f"[StreamingTTS] Kokoro array dtype: {raw_array.dtype}, shape: {raw_array.shape}, range: [{np.min(raw_array):.3f}, {np.max(raw_array):.3f}]")

                    if raw_array.dtype == np.int16:
                        # Convert int16 to float32 and normalize to [-1, 1]
                        audio_data = raw_array.astype(np.float32) / 32768.0
                    elif raw_array.dtype == np.int32:
                        # Convert int32 to float32 and normalize to [-1, 1]
                        audio_data = raw_array.astype(np.float32) / 2147483648.0
                    elif raw_array.dtype in [np.float32, np.float64]:
                        # Already float - but might need range adjustment
                        audio_data = raw_array.astype(np.float32)
                        # If range is outside [-1, 1], normalize it
                        max_val = np.max(np.abs(audio_data))
                        if max_val > 1.0:
                            print(f"[StreamingTTS] Normalizing float audio data from range ±{max_val:.3f}")
                            audio_data = audio_data / max_val
                    else:
                        # Unknown dtype, convert and normalize
                        print(f"[StreamingTTS] Unknown dtype {raw_array.dtype}, treating as float")
                        audio_data = raw_array.astype(np.float32)

                    sample_rate = kokoro_sample_rate
            else:
                # Fallback: try to read as WAV format (shouldn't happen with this Kokoro version)
                try:
                    audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype='float32')
                except:
                    print("[StreamingTTS] Failed to read as WAV, treating as raw PCM")
                    # Assume 16-bit PCM at 22050 Hz
                    audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    sample_rate = 22050

            # Ensure mono audio
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            # Use higher quality resampling if needed (LiveKit requirement)
            if sample_rate != 16000:
                try:
                    # Try librosa for higher quality resampling
                    import librosa
                    audio_data = librosa.resample(audio_data, orig_sr=sample_rate, target_sr=16000)
                except ImportError:
                    # Fallback to scipy with better parameters
                    import scipy.signal
                    audio_data = scipy.signal.resample_poly(audio_data, 16000, sample_rate)

            # Convert to the format expected by LiveKit (float32 array)
            audio_frame = audio_data.astype(np.float32)

            # Apply gentle smoothing to reduce artifacts
            if len(audio_frame) > 10:
                # Simple moving average filter to smooth audio
                kernel_size = min(5, len(audio_frame) // 20)
                if kernel_size > 1:
                    kernel = np.ones(kernel_size) / kernel_size
                    audio_frame = np.convolve(audio_frame, kernel, mode='same')

            # For short sentences, stream as single chunk to avoid artifacts
            if len(audio_frame) <= 1600:  # 100ms or less at 16kHz
                # Send as single chunk
                chunk_int16 = (audio_frame * 32767).astype(np.int16)
                frame = rtc.AudioFrame(
                    data=chunk_int16.tobytes(),
                    sample_rate=16000,
                    num_channels=1,
                    samples_per_channel=len(audio_frame)
                )

                if self.audio_source and self._main_loop and not self._main_loop.is_closed():
                    try:
                        asyncio.run_coroutine_threadsafe(
                            self.audio_source.capture_frame(frame),
                            self._main_loop
                        )
                    except Exception as e:
                        print(f"[StreamingTTS] Error sending single audio frame: {e}")

                print(f"[StreamingTTS] Sent single audio chunk: {len(audio_frame)} samples")

            else:
                # For longer audio, use larger chunks with overlap to reduce artifacts
                chunk_size = 800  # 50ms at 16kHz (larger chunks = less artifacts)
                overlap = 80    # 5ms overlap between chunks

                for i in range(0, len(audio_frame), chunk_size - overlap):
                    chunk = audio_frame[i:i + chunk_size]
                    if len(chunk) < chunk_size:
                        # Pad the last chunk if needed
                        chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

                    # Apply fade-in/fade-out to reduce clicks between chunks
                    if len(chunk) > overlap * 2:
                        fade_samples = min(overlap // 2, 20)  # Small fade
                        if i > 0:  # Fade-in (except first chunk)
                            fade_in = np.linspace(0, 1, fade_samples)
                            chunk[:fade_samples] *= fade_in
                        if i + chunk_size < len(audio_frame):  # Fade-out (except last chunk)
                            fade_out = np.linspace(1, 0, fade_samples)
                            chunk[-fade_samples:] *= fade_out

                    # Send audio frame to LiveKit
                    if self.audio_source:
                        # Convert float32 audio data to int16 for LiveKit
                        chunk_int16 = (chunk * 32767).astype(np.int16)
                        frame = rtc.AudioFrame(
                            data=chunk_int16.tobytes(),
                            sample_rate=16000,
                            num_channels=1,
                            samples_per_channel=len(chunk)
                        )

                        # Use thread-safe method to schedule in the main event loop
                        if self._main_loop and not self._main_loop.is_closed():
                            try:
                                asyncio.run_coroutine_threadsafe(
                                    self.audio_source.capture_frame(frame),
                                    self._main_loop
                                )
                            except Exception as e:
                                print(f"[StreamingTTS] Error sending chunked audio frame: {e}")

                        # Debug: Log frame details occasionally
                        if i == 0:
                            print(f"[StreamingTTS] Streaming {len(audio_frame)} samples in chunks of {chunk_size}")

                print(f"[StreamingTTS] Completed streaming: {len(audio_frame)} samples")

            print(f"[StreamingTTS] Kokoro synthesis completed: {len(audio_frame)} samples")

        except Exception as e:
            print(f"[StreamingTTS] Kokoro synthesis failed: {e}")
            import traceback
            traceback.print_exc()

    async def _async_synthesize_with_kokoro_pausable(self, sentence: str):
        """Async synthesis with Kokoro TTS with immediate pause support."""
        try:
            if not self.kokoro_model:
                print("[StreamingTTS] Kokoro model not initialized")
                return

            print(f"[StreamingTTS] Async Kokoro synthesizing (pausable): '{sentence}'")

            # Check pause before starting
            if self.is_paused:
                await self._store_pause_state(sentence, 0, 0, None)
                return

            # Generate audio using high-quality voice selection
            preferred_voices = ['af_sarah', 'af_bella', 'af_nicole', 'af_sky', 'af']
            audio_bytes = None

            for voice in preferred_voices:
                try:
                    print(f"[StreamingTTS] Trying voice: {voice}")

                    # Check pause before each voice attempt
                    if self.is_paused:
                        await self._store_pause_state(sentence, 0, 0, None)
                        return

                    # Run Kokoro synthesis in thread pool to avoid blocking async loop
                    audio_bytes = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: self.kokoro_model.create(sentence, voice=voice)
                    )
                    print(f"[StreamingTTS] Successfully using voice: {voice}")
                    break
                except Exception as voice_error:
                    print(f"[StreamingTTS] Voice '{voice}' failed: {voice_error}")
                    continue

            if audio_bytes is None:
                try:
                    print("[StreamingTTS] All preferred voices failed, trying default voice")

                    # Check pause before default voice
                    if self.is_paused:
                        await self._store_pause_state(sentence, 0, 0, None)
                        return

                    audio_bytes = await asyncio.get_event_loop().run_in_executor(
                        None, lambda: self.kokoro_model.create(sentence)
                    )
                except Exception as e:
                    print(f"[StreamingTTS] Default voice also failed: {e}")
                    return

            # Check pause after synthesis
            if self.is_paused:
                await self._store_pause_state(sentence, 0, 0, None)
                return

            # Process audio data
            audio_data = await self._process_kokoro_audio(audio_bytes)
            if audio_data is None:
                return

            # Check pause before streaming
            if self.is_paused:
                await self._store_pause_state(sentence, 0, 0, None)
                return

            # Stream with pause checking
            await self._stream_audio_with_pause_check(audio_data)

            if not self.is_paused:
                print(f"[StreamingTTS] Async Kokoro synthesis completed for: '{sentence}'")

        except Exception as e:
            print(f"[StreamingTTS] Async Kokoro synthesis failed: {e}")
            import traceback
            traceback.print_exc()

    async def _async_synthesize_with_kokoro(self, sentence: str):
        """Legacy Kokoro method - redirects to pausable version."""
        await self._async_synthesize_with_kokoro_pausable(sentence)

    async def _process_kokoro_audio(self, audio_bytes):
        """Process Kokoro audio data into high-quality float32 array."""
        try:
            # Handle Kokoro's create() method return format
            if isinstance(audio_bytes, tuple):
                raw_audio_data, kokoro_sample_rate = audio_bytes
                print(f"[StreamingTTS] Kokoro returned raw PCM data: sample_rate={kokoro_sample_rate}")

                # Convert raw PCM data to numpy array
                if isinstance(raw_audio_data, bytes):
                    # Raw PCM bytes - convert to float32 array
                    audio_data = np.frombuffer(raw_audio_data, dtype=np.int16).astype(np.float32) / 32768.0
                    sample_rate = kokoro_sample_rate
                else:
                    # Already numpy array - normalize properly
                    raw_array = np.array(raw_audio_data)
                    if raw_array.dtype == np.int16:
                        audio_data = raw_array.astype(np.float32) / 32768.0
                    elif raw_array.dtype == np.int32:
                        audio_data = raw_array.astype(np.float32) / 2147483648.0
                    elif raw_array.dtype in [np.float32, np.float64]:
                        audio_data = raw_array.astype(np.float32)
                        # Normalize if needed
                        max_val = np.max(np.abs(audio_data))
                        if max_val > 1.0:
                            audio_data = audio_data / max_val
                    else:
                        audio_data = raw_array.astype(np.float32)
                    sample_rate = kokoro_sample_rate
            else:
                # Fallback for WAV format
                try:
                    import soundfile as sf
                    audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype='float32')
                except:
                    audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0
                    sample_rate = 22050

            # Ensure mono audio
            if len(audio_data.shape) > 1:
                audio_data = np.mean(audio_data, axis=1)

            # High-quality resampling to 16kHz if needed
            if sample_rate != 16000:
                try:
                    import librosa
                    audio_data = librosa.resample(audio_data, orig_sr=sample_rate, target_sr=16000, res_type='kaiser_best')
                    print(f"[StreamingTTS] High-quality resampling from {sample_rate}Hz to 16kHz")
                except ImportError:
                    import scipy.signal
                    audio_data = scipy.signal.resample_poly(audio_data, 16000, sample_rate)
                    print(f"[StreamingTTS] Basic resampling from {sample_rate}Hz to 16kHz")

            # Clean up audio more carefully
            # Remove DC offset
            audio_data = audio_data - np.mean(audio_data)

            # Gentle normalization - avoid aggressive scaling that causes distortion
            max_val = np.max(np.abs(audio_data))
            if max_val > 0.98:  # Only normalize if really needed
                audio_data = audio_data * (0.85 / max_val)  # More conservative scaling
                print(f"[StreamingTTS] Normalized audio from peak {max_val:.3f} to 0.85")
            elif max_val < 0.1:  # Too quiet - boost a bit
                audio_data = audio_data * (0.3 / max_val)
                print(f"[StreamingTTS] Boosted quiet audio from peak {max_val:.3f} to 0.3")

            # Final range check
            final_max = np.max(np.abs(audio_data))
            print(f"[StreamingTTS] Final audio range: [{np.min(audio_data):.3f}, {np.max(audio_data):.3f}], peak: {final_max:.3f}")

            return audio_data.astype(np.float32)

        except Exception as e:
            print(f"[StreamingTTS] Error processing Kokoro audio: {e}")
            return None

    async def _stream_audio_smoothly(self, audio_data: np.ndarray):
        """Stream audio data to LiveKit with optimized quality and speed."""
        try:
            if not self.audio_source or len(audio_data) == 0:
                return

            print(f"[StreamingTTS] Streaming audio: {len(audio_data)} samples, range: [{np.min(audio_data):.3f}, {np.max(audio_data):.3f}]")

            # Add minimal silence padding to prevent clicks (5ms instead of 10ms)
            silence_samples = 80  # 5ms at 16kHz
            silence = np.zeros(silence_samples, dtype=np.float32)
            padded_audio = np.concatenate([silence, audio_data, silence])

            # Use larger chunks for better performance and less overhead
            chunk_size = 960  # 60ms at 16kHz (3x larger = less overhead)
            chunks_sent = 0

            for i in range(0, len(padded_audio), chunk_size):
                chunk = padded_audio[i:i + chunk_size]

                # Pad final chunk if necessary
                if len(chunk) < chunk_size:
                    chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

                # Careful conversion to int16 - avoid clipping
                # Scale by 32767 but ensure no values exceed range
                chunk_clipped = np.clip(chunk, -1.0, 1.0)  # Ensure range is [-1, 1]
                chunk_int16 = (chunk_clipped * 32767).astype(np.int16)

                # Create and send frame
                frame = rtc.AudioFrame(
                    data=chunk_int16.tobytes(),
                    sample_rate=16000,
                    num_channels=1,
                    samples_per_channel=len(chunk)
                )

                await self.audio_source.capture_frame(frame)
                chunks_sent += 1

                # NO artificial delays - let LiveKit handle timing internally
                # This was causing slow playback!

            print(f"[StreamingTTS] Streamed {chunks_sent} chunks ({len(audio_data)} samples) - no artificial delays")

        except Exception as e:
            print(f"[StreamingTTS] Error in audio streaming: {e}")

    def _synthesize_with_pyttsx3(self, sentence: str):
        """Synthesize speech using pyttsx3 (system TTS)."""
        try:
            # For now, this will play locally
            # TODO: Capture audio output and stream to LiveKit
            self.tts_engine.say(sentence)
            self.tts_engine.runAndWait()
            print(f"[StreamingTTS] pyttsx3 synthesis completed for: '{sentence}'")
        except Exception as e:
            print(f"[StreamingTTS] pyttsx3 synthesis failed: {e}")

    async def _synthesize_with_edge_tts(self, sentence: str):
        """Synthesize speech using Edge TTS."""
        try:
            import tempfile
            import os

            # Create Edge TTS communication
            communicate = edge_tts.Communicate(sentence, "en-US-AriaNeural")

            # Generate audio to temporary file
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                await communicate.save(tmp_file.name)

                # Load and stream the audio file
                await self._load_and_stream_audio_file(tmp_file.name)

                # Clean up temp file
                os.unlink(tmp_file.name)

            print(f"[StreamingTTS] Edge TTS synthesis completed for: '{sentence}'")
        except Exception as e:
            print(f"[StreamingTTS] Edge TTS synthesis failed: {e}")

    async def _async_synthesize_with_edge_tts_pausable(self, sentence: str):
        """Async synthesis with Edge TTS with immediate pause support."""
        try:
            import tempfile
            import os

            print(f"[StreamingTTS] Async Edge TTS synthesizing (pausable): '{sentence}'")

            # Check pause before starting synthesis
            if self.is_paused:
                await self._store_pause_state(sentence, 0, 0, None)
                return

            # Use a higher quality voice for better sound
            voice_options = [
                "en-US-AriaNeural",   # Clear, natural
                "en-US-JennyNeural",  # Professional
                "en-US-GuyNeural",    # Male alternative
                "en-US-SaraNeural"    # Alternative female
            ]

            audio_data = None
            for voice in voice_options:
                try:
                    print(f"[StreamingTTS] Trying Edge TTS voice: {voice}")

                    # Check pause before each voice attempt
                    if self.is_paused:
                        await self._store_pause_state(sentence, 0, 0, None)
                        return

                    # Create Edge TTS communication
                    communicate = edge_tts.Communicate(sentence, voice)

                    # Generate audio to temporary file
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                        await communicate.save(tmp_file.name)

                        # Check pause after synthesis
                        if self.is_paused:
                            os.unlink(tmp_file.name)
                            await self._store_pause_state(sentence, 0, 0, None)
                            return

                        # Load and process the audio file
                        audio_data = await self._load_and_process_audio_file(tmp_file.name)

                        # Clean up temp file
                        os.unlink(tmp_file.name)

                    if audio_data is not None:
                        print(f"[StreamingTTS] Successfully used Edge TTS voice: {voice}")
                        break

                except Exception as voice_error:
                    print(f"[StreamingTTS] Edge TTS voice '{voice}' failed: {voice_error}")
                    continue

            if audio_data is not None:
                # Check pause before streaming
                if self.is_paused:
                    await self._store_pause_state(sentence, 0, 0, None)
                    return

                # Stream with pause checking
                await self._stream_audio_with_pause_check(audio_data)

                if not self.is_paused:
                    print(f"[StreamingTTS] Async Edge TTS synthesis completed for: '{sentence}'")
            else:
                print(f"[StreamingTTS] All Edge TTS voices failed for: '{sentence}'")
        except Exception as e:
            print(f"[StreamingTTS] Async Edge TTS synthesis failed: {e}")

    async def _async_synthesize_with_edge_tts(self, sentence: str):
        """Legacy Edge TTS method - redirects to pausable version."""
        await self._async_synthesize_with_edge_tts_pausable(sentence)

    async def _async_synthesize_with_pyttsx3(self, sentence: str):
        """Async synthesis with pyttsx3 - basic fallback."""
        try:
            # For now, just log (pyttsx3 is hard to capture properly)
            print(f"[StreamingTTS] pyttsx3 async synthesis not implemented for: '{sentence}'")
            # TODO: Implement proper pyttsx3 audio capture and streaming
        except Exception as e:
            print(f"[StreamingTTS] Async pyttsx3 synthesis failed: {e}")

    async def _load_and_process_audio_file(self, audio_file_path: str):
        """Load and process an audio file for streaming."""
        try:
            # Try soundfile first (higher quality)
            try:
                import soundfile as sf
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

            # High-quality resampling if needed
            if sample_rate != 16000:
                try:
                    import librosa
                    audio_data = librosa.resample(audio_data, orig_sr=sample_rate, target_sr=16000, res_type='kaiser_best')
                except ImportError:
                    import scipy.signal
                    audio_data = scipy.signal.resample_poly(audio_data, 16000, sample_rate)

            # Clean up audio (same careful approach as Kokoro)
            audio_data = audio_data - np.mean(audio_data)  # Remove DC offset

            # Gentle normalization to avoid distortion
            max_val = np.max(np.abs(audio_data))
            if max_val > 0.98:
                audio_data = audio_data * (0.85 / max_val)
                print(f"[StreamingTTS] Edge TTS normalized from peak {max_val:.3f} to 0.85")
            elif max_val < 0.1:
                audio_data = audio_data * (0.3 / max_val)
                print(f"[StreamingTTS] Edge TTS boosted from peak {max_val:.3f} to 0.3")

            print(f"[StreamingTTS] Edge TTS final range: [{np.min(audio_data):.3f}, {np.max(audio_data):.3f}]")
            return audio_data.astype(np.float32)

        except Exception as e:
            print(f"[StreamingTTS] Error loading/processing audio file: {e}")
            return None

    async def _load_and_stream_audio_file(self, audio_file_path: str):
        """Load an audio file and stream it to LiveKit."""
        try:
            from pydub import AudioSegment

            # Load audio file
            audio = AudioSegment.from_file(audio_file_path)

            # Convert to 16kHz mono
            audio = audio.set_frame_rate(16000).set_channels(1)

            # Convert to numpy array
            audio_data = np.array(audio.get_array_of_samples(), dtype=np.float32)
            audio_data = audio_data / 32768.0  # Normalize to [-1, 1]

            # Stream to LiveKit
            await self._stream_audio_to_livekit(audio_data)

        except Exception as e:
            print(f"[StreamingTTS] Error loading/streaming audio file: {e}")

    def _on_tts_start(self):
        """Callback when TTS starts processing."""
        print("[StreamingTTS] TTS processing started")

    def _on_tts_stop(self):
        """Callback when TTS stops processing."""
        print("[StreamingTTS] TTS processing stopped")

    async def _async_on_audio_start(self):
        """Async callback when audio playback starts."""
        print("[StreamingTTS] Audio playback started")
        self.is_speaking = True
        if self.on_speaking_state_change:
            try:
                await self.on_speaking_state_change(True)
            except Exception as e:
                print(f"[StreamingTTS] Error in speaking state callback: {e}")

    async def _async_on_audio_stop(self):
        """Async callback when audio playback stops."""
        print("[StreamingTTS] Audio playback stopped")
        self.is_speaking = False
        if self.on_speaking_state_change:
            try:
                await self.on_speaking_state_change(False)
            except Exception as e:
                print(f"[StreamingTTS] Error in speaking state callback: {e}")

    def _on_audio_start(self):
        """Callback when audio playback starts."""
        print("[StreamingTTS] Audio playback started")
        self.is_speaking = True
        if self.on_speaking_state_change:
            try:
                # Try to get the current event loop and schedule the callback
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.call_soon_threadsafe(lambda: asyncio.create_task(self.on_speaking_state_change(True)))
                    else:
                        # No event loop running, skip the callback
                        pass
                except RuntimeError:
                    # No event loop available, skip the callback
                    pass
            except Exception as e:
                print(f"[StreamingTTS] Error in speaking state callback: {e}")

    def _on_audio_stop(self):
        """Callback when audio playback stops."""
        print("[StreamingTTS] Audio playbook stopped")
        self.is_speaking = False
        if self.on_speaking_state_change:
            try:
                # Try to get the current event loop and schedule the callback
                try:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.call_soon_threadsafe(lambda: asyncio.create_task(self.on_speaking_state_change(False)))
                    else:
                        # No event loop running, skip the callback
                        pass
                except RuntimeError:
                    # No event loop available, skip the callback
                    pass
            except Exception as e:
                print(f"[StreamingTTS] Error in speaking state callback: {e}")

    def extract_complete_sentences(self, text_chunk: str) -> Tuple[List[str], str]:
        """
        Extract complete sentences from text chunk.
        Returns: (complete_sentences, remaining_fragment)
        """
        # Add new text to buffer
        self.sentence_buffer += text_chunk

        # Define sentence endings (including some common abbreviations handling)
        sentence_pattern = r'([^.!?]*[.!?]+(?:\s|$))'

        # Find all complete sentences
        sentences = re.findall(sentence_pattern, self.sentence_buffer)
        complete_sentences = [s.strip() for s in sentences if s.strip()]

        # Calculate remaining text after sentences
        if complete_sentences:
            # Find the position after the last complete sentence
            last_sentence_end = 0
            for sentence in complete_sentences:
                # Find this sentence in the buffer and update position
                pos = self.sentence_buffer.find(sentence, last_sentence_end)
                if pos != -1:
                    last_sentence_end = pos + len(sentence)

            # Remaining text after last complete sentence
            remaining = self.sentence_buffer[last_sentence_end:].strip()
        else:
            remaining = self.sentence_buffer

        # Update buffer with remaining fragment
        self.sentence_buffer = remaining

        return complete_sentences, remaining

    async def process_text_chunk(self, text_chunk: str, message_id: str = None, stream_id: str = None):
        """
        Process incoming text chunk, extracting and queuing complete sentences.
        Only abandon paused content if this is a completely new message (different message_id).

        Args:
            text_chunk: The text content to process
            message_id: Unique identifier for the complete message/response
            stream_id: Unique identifier for the streaming session
        """
        try:
            # Determine if this is a new message or continuation of current message
            is_new_message = False
            if message_id and message_id != self.current_message_id:
                is_new_message = True
                print(f"[StreamingTTS] New message detected: {message_id} (was: {self.current_message_id})")
                self.current_message_id = message_id
                self.current_stream_id = stream_id
            elif not message_id:
                # No message ID provided - treat as continuation for backward compatibility
                print(f"[StreamingTTS] Processing text chunk (no message ID - assuming continuation)")
            else:
                # Same message ID - this is a continuation chunk
                print(f"[StreamingTTS] Processing continuation chunk for message: {message_id}")

            # Only abandon paused content if this is a completely new message
            if is_new_message and self.is_paused and (self.pause_state.get("current_sentence") or not self.sentence_queue.empty()):
                print("[StreamingTTS] 🔄 New message detected while paused - abandoning old content")
                await self._abandon_paused_content()

            # Extract complete sentences
            sentences, remaining = self.extract_complete_sentences(text_chunk)

            # Queue complete sentences for TTS processing
            for sentence in sentences:
                if sentence.strip():
                    print(f"[StreamingTTS] Queueing sentence: '{sentence}'")
                    await self.sentence_queue.put(sentence.strip())

            # print(f"[StreamingTTS] Processed chunk: {len(sentences)} sentences, remaining: '{remaining}'")

        except Exception as e:
            print(f"[StreamingTTS] Error processing text chunk: {e}")

    async def flush_remaining_text(self):
        """
        Process any remaining text in buffer as final sentence.
        Call this when response stream is complete.
        """
        try:
            if self.sentence_buffer.strip():
                final_text = self.sentence_buffer.strip()
                print(f"[StreamingTTS] Flushing remaining text as final sentence: '{final_text}'")
                await self.sentence_queue.put(final_text)
                self.sentence_buffer = ""

        except Exception as e:
            print(f"[StreamingTTS] Error flushing remaining text: {e}")

    def get_speaking_state(self) -> bool:
        """Get current speaking state."""
        return self.is_speaking

    async def pause(self):
        """Pause TTS synthesis and streaming immediately."""
        try:
            if not self.is_paused:
                self.is_paused = True
                self.pause_event.clear()
                print("[StreamingTTS] ⏸️ TTS paused immediately by user request")

                # If currently synthesizing, mark as paused mid-synthesis
                if self.pause_state["current_sentence"]:
                    self.pause_state["paused_during_synthesis"] = True
                    self.pause_state["pause_timestamp"] = time.time()
                    print(f"[StreamingTTS] Paused mid-sentence: '{self.pause_state['current_sentence'][:50]}...'")

                # Send confirmation to frontend
                await self._send_pause_confirmation()
        except Exception as e:
            print(f"[StreamingTTS] Error pausing TTS: {e}")

    async def resume(self):
        """Resume TTS synthesis and streaming from exact pause point."""
        try:
            if self.is_paused:
                self.is_paused = False
                self.pause_event.set()
                print("[StreamingTTS] ▶️ TTS resumed by user request")

                # Resume from exact pause point using improved logic with concurrency control
                async with self.resume_lock:
                    self.resume_in_progress = True
                    try:
                        # First validate the pause state before attempting resume
                        if self._validate_pause_state():
                            await self._resume_from_pause_state()
                        else:
                            print("[StreamingTTS] ⚠️ Invalid pause state detected, clearing and resuming normally")
                            self._clear_pause_state()
                    finally:
                        self.resume_in_progress = False
                        print("[StreamingTTS] 🔓 Resume operation completed, queue processing can continue")

                        # After resume, check if we need to continue with stored sentence processing
                        await self._continue_queue_processing_after_resume()

                # Send confirmation to frontend
                await self._send_resume_confirmation()
        except Exception as e:
            print(f"[StreamingTTS] Error resuming TTS: {e}")

    async def _store_pause_state(self, sentence: str, text_position: int, audio_position: int = 0, remaining_audio: np.ndarray = None):
        """Store comprehensive pause state for precise resume."""
        import time
        self.pause_state.update({
            "current_sentence": sentence,
            "sentence_text_position": text_position,
            "audio_samples_position": audio_position,
            "remaining_audio_data": remaining_audio,
            "paused_during_synthesis": True,
            "pause_timestamp": time.time(),
            "synthesis_complete": remaining_audio is None and text_position >= len(sentence)
        })
        print(f"[StreamingTTS] 📍 Stored pause state: sentence='{sentence[:30]}...', text_pos={text_position}, audio_pos={audio_position}, has_audio={remaining_audio is not None}")

    async def _stream_audio_with_pause_check(self, audio_data: np.ndarray):
        """Stream audio data with immediate pause checking between chunks."""
        try:
            if not self.audio_source or len(audio_data) == 0:
                return

            # Use smaller chunks for more responsive pausing
            chunk_size = 480  # 30ms at 16kHz - very responsive
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

                # Capture frame with retry logic for InvalidState errors
                retry_count = 0
                max_retries = 3
                frame_sent = False
                while retry_count < max_retries:
                    try:
                        await self.audio_source.capture_frame(frame)
                        chunks_sent += 1
                        frame_sent = True
                        break
                    except Exception as e:
                        error_msg = str(e)
                        if "InvalidState" in error_msg and retry_count < max_retries - 1:
                            print(f"[StreamingTTS] ⚠️ Audio capture failed (attempt {retry_count + 1}): {error_msg}, retrying...")
                            retry_count += 1
                            await asyncio.sleep(0.05)  # Brief pause before retry
                        else:
                            print(f"[StreamingTTS] ❌ Audio capture failed permanently during streaming: {error_msg}")
                            # Store current position for potential resume
                            await self._store_pause_state(
                                self.pause_state.get("current_sentence", ""),
                                int((i / len(audio_data)) * len(self.pause_state.get("current_sentence", ""))),
                                i,
                                audio_data[i:]
                            )
                            return

                if not frame_sent:
                    print("[StreamingTTS] ❌ Failed to send audio frame during streaming")
                    return

                # Check for pause AFTER sending this chunk (so we know exactly where we stopped)
                if self.is_paused:
                    next_audio_position = i + chunk_size
                    remaining_audio = audio_data[next_audio_position:] if next_audio_position < len(audio_data) else None

                    # Calculate text position based on audio progress (approximate)
                    if len(audio_data) > 0:
                        progress_ratio = next_audio_position / len(audio_data)
                        text_position = int(progress_ratio * len(self.pause_state.get("current_sentence", "")))
                    else:
                        text_position = 0

                    print(f"[StreamingTTS] ⏸️ Pause detected after chunk {chunks_sent}, audio_pos={next_audio_position}, text_pos={text_position}")
                    await self._store_pause_state(
                        self.pause_state.get("current_sentence", ""),
                        text_position,
                        next_audio_position,
                        remaining_audio
                    )
                    break

                # Minimal delay to allow pause check
                await asyncio.sleep(0.001)

            if not self.is_paused:
                print(f"[StreamingTTS] Completed streaming {chunks_sent} chunks ({len(audio_data)} samples)")
                # Mark synthesis as complete in pause state
                self.pause_state["synthesis_complete"] = True
            else:
                print(f"[StreamingTTS] Streaming paused after {chunks_sent} chunks")

        except Exception as e:
            print(f"[StreamingTTS] Error in pausable audio streaming: {e}")

    async def _send_pause_confirmation(self):
        """Send pause confirmation to frontend."""
        try:
            message = {
                "type": "tts_paused",
                "data": {
                    "status": "paused",
                    "timestamp": time.time()
                }
            }
            await self._send_message_to_frontend(message)
        except Exception as e:
            print(f"[StreamingTTS] Error sending pause confirmation: {e}")

    async def _send_resume_confirmation(self):
        """Send resume confirmation to frontend."""
        try:
            message = {
                "type": "tts_resumed",
                "data": {
                    "status": "resumed",
                    "timestamp": time.time()
                }
            }
            await self._send_message_to_frontend(message)
        except Exception as e:
            print(f"[StreamingTTS] Error sending resume confirmation: {e}")

    async def _send_message_to_frontend(self, message):
        """Send a message to the frontend via LiveKit."""
        try:
            import json
            message_json = json.dumps(message)
            message_bytes = message_json.encode("utf-8")
            await self.room.local_participant.publish_data(message_bytes, reliable=True)
        except Exception as e:
            print(f"[StreamingTTS] Error sending message to frontend: {e}")

    async def _stream_remaining_audio(self, remaining_audio_data: np.ndarray, start_position: int = 0):
        """Continue streaming audio data from a specific position with enhanced tracking."""
        try:
            if not self.audio_source or remaining_audio_data is None or len(remaining_audio_data) == 0:
                print("[StreamingTTS] No remaining audio data to stream")
                self._clear_pause_state()
                await self._async_on_audio_stop()
                return

            chunk_size = 480  # 30ms chunks for responsive pausing
            print(f"[StreamingTTS] ▶️ Seamlessly resuming audio: {len(remaining_audio_data)} samples from position {start_position}")

            chunks_sent = 0
            for i in range(0, len(remaining_audio_data), chunk_size):
                chunk = remaining_audio_data[i:i + chunk_size]
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

                # Capture frame with retry logic for InvalidState errors
                retry_count = 0
                max_retries = 3
                frame_sent = False
                while retry_count < max_retries:
                    try:
                        await self.audio_source.capture_frame(frame)
                        chunks_sent += 1
                        frame_sent = True
                        break
                    except Exception as e:
                        error_msg = str(e)
                        if "InvalidState" in error_msg and retry_count < max_retries - 1:
                            print(f"[StreamingTTS] ⚠️ Audio capture failed (attempt {retry_count + 1}): {error_msg}, retrying...")
                            retry_count += 1
                            await asyncio.sleep(0.05)  # Brief pause before retry
                        else:
                            print(f"[StreamingTTS] ❌ Audio capture failed permanently: {error_msg}")
                            # Try fallback strategy instead of clearing state immediately
                            await self._handle_audio_failure_during_resume(remaining_audio_data, i, start_position)
                            return

                if not frame_sent:
                    # Should not reach here, but safety check
                    print("[StreamingTTS] ❌ Failed to send audio frame after retries")
                    await self._handle_audio_failure_during_resume(remaining_audio_data, i, start_position)
                    return

                # Check for pause AFTER sending this chunk
                if self.is_paused:
                    next_audio_position = i + chunk_size
                    new_remaining_audio = remaining_audio_data[next_audio_position:] if next_audio_position < len(remaining_audio_data) else None

                    # Update pause state with new position
                    current_sentence = self.pause_state.get("current_sentence", "")
                    if len(remaining_audio_data) > 0:
                        progress_ratio = next_audio_position / len(remaining_audio_data)
                        text_position = int(progress_ratio * len(current_sentence))
                    else:
                        text_position = len(current_sentence)

                    print(f"[StreamingTTS] ⏸️ Paused again during resume after chunk {chunks_sent}")
                    await self._store_pause_state(
                        current_sentence,
                        text_position,
                        start_position + next_audio_position,
                        new_remaining_audio
                    )
                    break

                # Minimal delay to allow pause check
                await asyncio.sleep(0.001)

            if not self.is_paused:
                # Completed streaming all remaining audio
                print(f"[StreamingTTS] ✅ Completed seamless resume: {chunks_sent} chunks")
                # Mark synthesis as complete before clearing state
                self.pause_state["synthesis_complete"] = True
                self._clear_pause_state()
                await self._async_on_audio_stop()
            else:
                print(f"[StreamingTTS] Resume streaming paused after {chunks_sent} chunks")

        except Exception as e:
            print(f"[StreamingTTS] ❌ Error in remaining audio streaming: {e}")
            self._clear_pause_state()

    async def _abandon_paused_content(self):
        """Abandon paused TTS playback state for new message (keep old message content intact)."""
        try:
            print("[StreamingTTS] Abandoning paused TTS playback for new message...")

            # Clear current TTS synthesis state (but keep message content)
            if self.pause_state.get("current_sentence"):
                print(f"[StreamingTTS] Abandoning TTS synthesis of: '{self.pause_state['current_sentence'][:50]}...'")

            # Clear all TTS pause/resume tracking state
            self._clear_pause_state()

            # Clear any queued TTS sentences from the old message
            cleared_count = 0
            while not self.sentence_queue.empty():
                try:
                    old_sentence = await self.sentence_queue.get()
                    print(f"[StreamingTTS] Discarding queued TTS: '{old_sentence[:30]}...'")
                    self.sentence_queue.task_done()
                    cleared_count += 1
                except:
                    break

            if cleared_count > 0:
                print(f"[StreamingTTS] Discarded {cleared_count} queued TTS sentences from old message")

            # Auto-resume TTS processing for new content (old TTS is abandoned, not resumed)
            if self.is_paused:
                print("[StreamingTTS] Auto-resuming TTS for new message content")
                self.is_paused = False
                self.pause_event.set()

                # Send resume confirmation to frontend
                await self._send_resume_confirmation()

            print("[StreamingTTS] ✅ Ready to process TTS for new message")
            print("[StreamingTTS] Note: Old message content remains visible in chat")

        except Exception as e:
            print(f"[StreamingTTS] Error abandoning paused TTS content: {e}")

    async def stop_speaking(self):
        """Stop current TTS playback."""
        try:
            if self.tts_stream and self.tts_stream.is_playing():
                print("[StreamingTTS] Stopping current playback")
                # Clear the queue
                while not self.sentence_queue.empty():
                    try:
                        self.sentence_queue.get_nowait()
                    except:
                        break

                # Stop current playback
                # Note: RealtimeTTS doesn't have a direct stop method,
                # so we'll need to handle this differently

        except Exception as e:
            print(f"[StreamingTTS] Error stopping TTS: {e}")

    async def _setup_audio_track(self):
        """Set up LiveKit audio track for streaming TTS output."""
        try:
            print("[StreamingTTS] Creating audio source (16kHz, 1 channel)...")
            # Create audio source (16kHz, 1 channel)
            self.audio_source = rtc.AudioSource(16000, 1)
            print(f"[StreamingTTS] Audio source created: {self.audio_source}")

            track = rtc.LocalAudioTrack.create_audio_track("assistant-speech", self.audio_source)
            self.audio_track = track
            print(f"[StreamingTTS] Audio track created: {track}")

            # Check room state before publishing
            print(f"[StreamingTTS] Room connected: {self.room.isconnected()}")
            print(f"[StreamingTTS] Local participant: {self.room.local_participant.identity}")

            # Publish the track
            options = rtc.TrackPublishOptions()
            # Use correct source type for TTS audio output
            # TTS should be published as SCREEN_SHARE_AUDIO or UNKNOWN, not MICROPHONE
            try:
                options.source = rtc.TrackSource.SCREEN_SHARE_AUDIO  # More appropriate for generated audio
                print("[StreamingTTS] Using SCREEN_SHARE_AUDIO source")
            except AttributeError:
                try:
                    options.source = rtc.TrackSource.UNKNOWN
                    print("[StreamingTTS] Using UNKNOWN source")
                except AttributeError:
                    print("[StreamingTTS] Using default source (no specification)")
                    # Just use default options without specifying source
                    pass

            print("[StreamingTTS] Publishing audio track...")
            publication = await self.room.local_participant.publish_track(track, options)

            print(f"[StreamingTTS] Audio track published successfully!")
            print(f"[StreamingTTS] Publication SID: {publication.sid}")
            print(f"[StreamingTTS] Publication muted: {publication.muted}")
            print(f"[StreamingTTS] Publication track: {publication.track}")

        except Exception as e:
            print(f"[StreamingTTS] Failed to setup audio track: {e}")
            import traceback
            traceback.print_exc()
            self.audio_source = None
            self.audio_track = None

    async def _stream_audio_to_livekit(self, audio_data: np.ndarray):
        """Stream audio data to LiveKit audio track."""
        try:
            if not self.audio_source or len(audio_data) == 0:
                return

            # Ensure audio_data is a numpy array
            if not isinstance(audio_data, np.ndarray):
                audio_data = np.array(audio_data, dtype=np.float32)

            # Flatten if multi-dimensional
            if audio_data.ndim > 1:
                audio_data = audio_data.flatten()

            # Normalize audio to [-1.0, 1.0] range if needed
            if audio_data.dtype != np.float32:
                audio_data = audio_data.astype(np.float32)

            # Clip audio to prevent overflow
            audio_data = np.clip(audio_data, -1.0, 1.0)

            # Convert float32 audio to int16 for LiveKit
            audio_int16 = (audio_data * 32767).astype(np.int16)

            # Create AudioFrame with proper sample count
            frame = rtc.AudioFrame.create(
                sample_rate=16000,
                num_channels=1,
                samples_per_channel=len(audio_int16)
            )

            # Copy audio data to frame
            frame.data[:len(audio_int16)] = audio_int16

            # Push frame to audio source
            await self.audio_source.capture_frame(frame)

            # Log progress occasionally to avoid spam
            if len(self.audio_capture_buffer) % 50 == 0:
                print(f"[StreamingTTS] Streamed audio chunk: {len(audio_int16)} samples")

        except Exception as e:
            print(f"[StreamingTTS] Error streaming audio to LiveKit: {e}")

    async def cleanup(self):
        """Clean up TTS resources."""
        try:
            print("[StreamingTTS] Cleaning up TTS service")

            # Signal async processing to stop
            self.stop_processing = True
            if self.sentence_queue:
                await self.sentence_queue.put(None)  # Shutdown signal

            # Wait for processing task to complete
            if self.processing_task and not self.processing_task.done():
                try:
                    await asyncio.wait_for(self.processing_task, timeout=2.0)
                except asyncio.TimeoutError:
                    print("[StreamingTTS] Processing task timeout, cancelling")
                    self.processing_task.cancel()

            # Clean up TTS resources
            if hasattr(self, 'tts_stream') and self.tts_stream:
                self.tts_stream = None
            if self.tts_engine:
                self.tts_engine = None

            print("[StreamingTTS] Cleanup completed")

        except Exception as e:
            print(f"[StreamingTTS] Error during cleanup: {e}")

    def cleanup_sync(self):
        """Synchronous cleanup wrapper for compatibility."""
        try:
            asyncio.create_task(self.cleanup())
        except RuntimeError:
            # No event loop running, just clean up what we can
            print("[StreamingTTS] Sync cleanup - no event loop available")
            self.stop_processing = True

    def _clear_pause_state(self):
        """Clear all pause state tracking."""
        self.pause_state = {
            "current_sentence": "",
            "sentence_text_position": 0,
            "audio_samples_position": 0,
            "remaining_audio_data": None,
            "paused_during_synthesis": False,
            "pause_timestamp": None,
            "synthesis_complete": False
        }
        print("[StreamingTTS] 🧨 Cleared pause state")

    async def _resume_from_pause_state(self):
        """Resume TTS from stored pause state with enhanced logic."""
        try:
            pause_state = self.pause_state
            current_sentence = pause_state.get("current_sentence", "")
            remaining_audio = pause_state.get("remaining_audio_data")
            text_position = pause_state.get("sentence_text_position", 0)
            audio_position = pause_state.get("audio_samples_position", 0)
            synthesis_complete = pause_state.get("synthesis_complete", False)

            if not current_sentence:
                print("[StreamingTTS] ℹ️ No sentence to resume")
                return

            print(f"[StreamingTTS] 🔄 Resuming from pause: sentence='{current_sentence[:30]}...', text_pos={text_position}, audio_pos={audio_position}")

            # Strategy 1: Resume from exact audio position if available
            if remaining_audio is not None and len(remaining_audio) > 0:
                # Validate audio source before attempting resume
                if await self._validate_audio_source():
                    print(f"[StreamingTTS] 🎧 Resuming from stored audio: {len(remaining_audio)} samples")
                    await self._stream_remaining_audio(remaining_audio, audio_position)
                    return
                else:
                    print("[StreamingTTS] ⚠️ Audio source not ready, falling back to text re-synthesis")

            # Strategy 2: Re-synthesize only the remaining text portion
            if text_position < len(current_sentence):
                remaining_text = current_sentence[text_position:].strip()
                if remaining_text:
                    print(f"[StreamingTTS] 🔁 Re-synthesizing remaining text: '{remaining_text[:30]}...'")
                    # Synthesize remaining text directly without queuing
                    self._clear_pause_state()  # Clear state first
                    await self._async_synthesize_sentence(remaining_text)
                    return

            # Strategy 3: Synthesis was complete, nothing to resume
            if synthesis_complete or text_position >= len(current_sentence):
                print("[StreamingTTS] ✅ Synthesis was complete, nothing to resume")
                self._clear_pause_state()
                await self._async_on_audio_stop()
                return

            # Fallback: Something went wrong, clear state
            print("[StreamingTTS] ⚠️ Unable to determine resume strategy, clearing state")
            self._clear_pause_state()

        except Exception as e:
            print(f"[StreamingTTS] ❌ Error in resume logic: {e}")
            self._clear_pause_state()

    def _validate_pause_state(self) -> bool:
        """Validate that pause state is consistent and recoverable."""
        try:
            pause_state = self.pause_state
            current_sentence = pause_state.get("current_sentence", "")
            text_position = pause_state.get("sentence_text_position", 0)
            remaining_audio = pause_state.get("remaining_audio_data")

            # Check basic consistency
            if not current_sentence:
                return False

            if text_position < 0 or text_position > len(current_sentence):
                print(f"[StreamingTTS] ⚠️ Invalid text position: {text_position} for sentence length {len(current_sentence)}")
                return False

            if remaining_audio is not None and len(remaining_audio) == 0:
                print("[StreamingTTS] ⚠️ Empty remaining audio data")
                return False

            return True

        except Exception as e:
            print(f"[StreamingTTS] ❌ Error validating pause state: {e}")
            return False

    async def _handle_audio_failure_during_resume(self, remaining_audio_data: np.ndarray, position: int, start_position: int):
        """Handle audio source failures during resume with fallback strategies."""
        try:
            print(f"[StreamingTTS] 🔧 Handling audio failure at position {position}, trying fallback strategies...")

            # Strategy 1: Try re-synthesizing the remaining text portion
            current_sentence = self.pause_state.get("current_sentence", "")
            if current_sentence and position > 0:
                # Calculate text position based on audio progress
                if len(remaining_audio_data) > 0:
                    progress_ratio = position / len(remaining_audio_data)
                    text_position = int(progress_ratio * len(current_sentence))
                    remaining_text = current_sentence[text_position:].strip()

                    if remaining_text:
                        print(f"[StreamingTTS] 🔄 Fallback: Re-synthesizing remaining text: '{remaining_text[:30]}...'")
                        # Clear current pause state and synthesize directly
                        self._clear_pause_state()
                        await self._async_synthesize_sentence(remaining_text)
                        return

            # Strategy 2: Clear state and continue with queue processing
            print("[StreamingTTS] 🔄 Fallback: Clearing pause state and continuing with queue")
            self._clear_pause_state()
            await self._async_on_audio_stop()

        except Exception as e:
            print(f"[StreamingTTS] ❌ Error in audio failure handling: {e}")
            self._clear_pause_state()

    async def _validate_audio_source(self) -> bool:
        """Validate that the audio source is ready for capture."""
        try:
            if not self.audio_source:
                print("[StreamingTTS] ⚠️ No audio source available")
                return False

            # Try a minimal validation - this might help detect InvalidState early
            # We don't actually send a frame, just check if the source exists and is accessible
            return True

        except Exception as e:
            print(f"[StreamingTTS] ⚠️ Audio source validation failed: {e}")
            return False

    async def _continue_queue_processing_after_resume(self):
        """Continue queue processing after resume, handling any stored sentences."""
        try:
            # Check if there's a stored sentence that needs processing
            stored_sentence = self.pause_state.get("current_sentence", "")
            text_position = self.pause_state.get("sentence_text_position", 0)
            synthesis_complete = self.pause_state.get("synthesis_complete", False)

            if stored_sentence and not synthesis_complete:
                # If we have partial progress, only process the remaining part
                if text_position > 0 and text_position < len(stored_sentence):
                    remaining_text = stored_sentence[text_position:].strip()
                    if remaining_text:
                        print(f"[StreamingTTS] 🔄 Processing remaining text after resume: '{remaining_text[:30]}...'")
                        # Clear the pause state first to prevent conflicts
                        self._clear_pause_state()
                        # Process only the remaining text
                        await self._async_synthesize_sentence(remaining_text)
                        return

                # If no progress or full sentence needs processing
                if text_position == 0:
                    print(f"[StreamingTTS] 🔄 Processing full stored sentence after resume: '{stored_sentence[:30]}...'")
                    # Clear the pause state first to prevent conflicts
                    self._clear_pause_state()
                    # Process the full stored sentence
                    await self._async_synthesize_sentence(stored_sentence)
                    return

            # Clear any remaining pause state
            if stored_sentence:
                print("[StreamingTTS] 🧹 Clearing completed pause state after resume")
                self._clear_pause_state()

        except Exception as e:
            print(f"[StreamingTTS] ❌ Error continuing queue processing after resume: {e}")
            self._clear_pause_state()
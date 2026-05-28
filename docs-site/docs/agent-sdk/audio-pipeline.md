---
sidebar_position: 5
title: "🎙️ Audio Pipeline"
---

# 🎙️ Audio Pipeline

The Audio Pipeline manages the flow of audio through your agent, handling speech-to-text (STT) and text-to-speech (TTS) conversion.

## Overview

```
Audio Input → STT → Text Processing → TTS → Audio Output
```

The pipeline handles:
- Receiving audio from LiveKit
- Converting speech to text (STT)
- Sending text to your agent for processing
- Converting responses to speech (TTS)
- Publishing audio back to LiveKit

## Basic Usage

```python
from stella_sdk import AudioPipeline

# Create pipeline with defaults
pipeline = AudioPipeline()

# Or configure providers
pipeline = AudioPipeline(
    stt_provider="sherpa",
    tts_provider="kokoro"
)
```

## STT Providers

### Sherpa (Default)

Local, open-source speech recognition:

```python
pipeline = AudioPipeline(
    stt_provider="sherpa",
    stt_config={
        "model": "sherpa-onnx-whisper-tiny.en",
        "sample_rate": 16000
    }
)
```

**Pros:**
- No API costs
- Low latency
- Privacy (runs locally)

**Cons:**
- Requires more CPU
- Less accurate than cloud services

### Whisper (OpenAI)

OpenAI's Whisper API:

```python
pipeline = AudioPipeline(
    stt_provider="whisper",
    stt_config={
        "model": "whisper-1",
        "language": "en"
    }
)
```

**Pros:**
- High accuracy
- Multi-language support

**Cons:**
- Requires API key
- Per-usage cost
- Network latency

### Deepgram

Deepgram's real-time transcription:

```python
pipeline = AudioPipeline(
    stt_provider="deepgram",
    stt_config={
        "model": "nova-2",
        "language": "en-US",
        "smart_format": True
    }
)
```

**Pros:**
- Real-time streaming
- High accuracy
- Speaker diarization

## TTS Providers

### Kokoro (Default)

Local TTS using Kokoro:

```python
pipeline = AudioPipeline(
    tts_provider="kokoro",
    tts_config={
        "voice": "af_heart",
        "speed": 1.0
    }
)
```

**Pros:**
- No API costs
- Low latency
- Privacy

**Cons:**
- Limited voices

### ElevenLabs

Premium voice synthesis:

```python
pipeline = AudioPipeline(
    tts_provider="elevenlabs",
    tts_config={
        "voice_id": "21m00Tcm4TlvDq8ikWAM",
        "model_id": "eleven_turbo_v2",
        "stability": 0.5,
        "similarity_boost": 0.75
    }
)
```

**Pros:**
- High-quality voices
- Voice cloning
- Emotional range

**Cons:**
- Per-character cost
- Requires API key

### OpenAI TTS

OpenAI's text-to-speech:

```python
pipeline = AudioPipeline(
    tts_provider="openai",
    tts_config={
        "model": "tts-1",
        "voice": "alloy"  # alloy, echo, fable, onyx, nova, shimmer
    }
)
```

### Voxtral (opt-in, non-commercial weights, vllm-omni sidecar)

Local Voxtral 4B TTS (`mistralai/Voxtral-4B-TTS-2603`). This is an **opt-in**
provider with two important properties:

- **Weights are CC-BY-NC-4.0** (non-commercial). STELLA does not bundle or
  redistribute them. The init container only downloads them when the
  operator sets `VOXTRAL_ACCEPT_NC_LICENSE=true` — that flag is the
  operator's acceptance of the model license.
- **Inference runs in a separate `vllm-omni` sidecar container** (image:
  `tts-vllm-omni`). Mistral only ships the model in their native format
  (no HF `config.json`), so the only supported inference path is via
  `vllm serve --omni`. The provider in `tts-service` is a thin HTTP client
  that POSTs to `http://localhost:8000/v1/audio/speech`.

To enable Voxtral:

1. Pick `TTS_PROVIDER=voxtral` in the wizard, set
   `VOXTRAL_ACCEPT_NC_LICENSE=true`, and provide an `HF_TOKEN` whose
   account has accepted the gated model license on
   <https://huggingface.co/mistralai/Voxtral-4B-TTS-2603>.

2. Deploy with `./scripts/start-k8s.sh`. The build step compiles the
   `tts-vllm-omni` sidecar image; the init container downloads the
   weights to the shared PVC; the sidecar then loads them on cold start
   (typically 60–180s on an L4).

3. Tuning knobs (all optional):

   ```bash
   VOXTRAL_DEFAULT_VOICE=casual_male            # casual_male/casual_female/...
   VOXTRAL_GPU_MEMORY_UTILIZATION=0.85          # 0.0–1.0; lower if sharing GPU
   VOXTRAL_MAX_MODEL_LEN=                       # blank = vllm auto-detect
   ```

```python
pipeline = AudioPipeline(
    tts_provider="voxtral",
)
```

**Pros:**
- High quality, expressive multilingual voice (9 languages, 20 presets)
- Local inference, no API costs
- Streaming-friendly via vllm's continuous-batching scheduler

**Cons:**
- Non-commercial license on the weights (operator obligation)
- Requires **≥16 GB GPU VRAM** per the Mistral model card. L4 (24 GB),
  A10/A10G, RTX 4090, L40S, A100, H100 all work. **Tesla T4 (15 GB) does
  not have enough VRAM and is not supported.**
- No pre-quantized variants compatible with vllm on Turing-era GPUs exist
  at time of writing — the MLX/MXFP/GGUF community quants don't work in
  this stack.

See `NOTICE.md` and `tts-service/NOTICE.md` for the full license split between
STELLA's permissively-licensed code and the operator-supplied CC-BY-NC weights.

## Pipeline Methods

### speech_to_text

```python
# Transcribe audio buffer
transcript = await pipeline.speech_to_text(audio_bytes)

# With streaming callback
async def on_partial(text: str, is_final: bool):
    print(f"{'Final' if is_final else 'Partial'}: {text}")

await pipeline.speech_to_text(
    audio_bytes,
    callback=on_partial
)
```

### text_to_speech

```python
# Generate audio from text
audio = await pipeline.text_to_speech("Hello, world!")

# Streaming TTS
async for audio_chunk in pipeline.text_to_speech_stream("Hello, world!"):
    await agent.publish_audio(audio_chunk)
```

## Voice Activity Detection (VAD)

The pipeline includes VAD to detect when someone is speaking:

```python
from stella_sdk import AudioPipeline, VADConfig

pipeline = AudioPipeline(
    vad_config=VADConfig(
        threshold=0.5,        # Detection sensitivity (0-1)
        min_speech_ms=250,    # Minimum speech duration
        min_silence_ms=500,   # Silence before end of speech
        sample_rate=16000
    )
)

# VAD events
pipeline.on_speech_start = lambda: print("Speech started")
pipeline.on_speech_end = lambda audio: print(f"Speech ended: {len(audio)} bytes")
```

## Turn Management (Transcript Gating)

The SDK enforces turn-based conversation flow at the pipeline level. Every agent using `audio_in()` gets this automatically — no agent-side code required.

### How It Works

```
User speaks → Final transcript yielded → Gate CLOSES
    → Agent processes (LLM) → Agent narrates (TTS) →
Gate OPENS → User can speak again
```

When the gate is closed:

| What happens | TTS enabled (`TTS_ENABLED=true`) | TTS disabled (`TTS_ENABLED=false`) |
|--------------|----------------------------------|-------------------------------------|
| Partial transcripts | Suppressed (not shown in frontend) | Still published to LiveKit |
| Final transcripts | Discarded | Discarded |
| Barge-in callbacks | Skipped (when `INTERRUPT_MODE=none`) | Skipped (when `INTERRUPT_MODE=none`) |
| STT stream | Stays alive (no reconnection) | Stays alive (no reconnection) |
| Data channel text | Queues for next turn | Queues for next turn |

With TTS enabled, the user's speech is completely invisible during the agent's turn — no partial transcripts appear in the frontend while the agent is processing or narrating. With TTS disabled, the gate opens quickly after processing, so brief partial display is acceptable.

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `TTS_ENABLED` | `true` | Controls whether TTS is active. When `true`, full transcription suppression during agent turn. When `false`, lighter gating |
| `INTERRUPT_MODE` | `none` | `none` = strict turn-based (default). `smart` = reserved for future barge-in with re-prompting |
| `TRANSCRIPT_DEBOUNCE_MS` | `300` | Debounce window for aggregating rapid successive finals before they reach the agent |

### SDK-Level Enforcement

The gating lives inside `audio_in()` in the `AudioPipeline`, so **every agent** gets it automatically:

```python
# Inside AudioPipeline.audio_in() — agents don't need to do anything
async for event in self.audio.audio_in():
    # Gate closes automatically when this yields
    # Gate opens automatically when the loop resumes
    response = await self.generate_response(event.text)
    await self.audio.speak(response)
    # ← gate opens here, user can speak again
```

Custom agents that override `run_audio_loop()` still get gating as long as they use `self.audio.audio_in()`. The gate methods (`close_transcript_gate()`, `open_transcript_gate()`) are also public for manual control.

## Interruption Handling

Handle when the user interrupts the agent:

```python
class MyAgent(BaseAgent):
    async def on_transcript(self, text: str, is_final: bool):
        if not is_final:
            # User is speaking - stop agent audio
            await self.stop_speaking()
            return

        # Process final transcript
        response = await self.generate_response(text)
        await self.speak(response)

    async def stop_speaking(self):
        """Stop any currently playing agent audio."""
        await self.pipeline.cancel_tts()
        await self.send_status("listening")
```

## Audio Format

Default audio format:

| Property | Value |
|----------|-------|
| Sample Rate | 16000 Hz |
| Channels | 1 (mono) |
| Bit Depth | 16-bit |
| Format | PCM |

Configure in the pipeline:

```python
pipeline = AudioPipeline(
    sample_rate=16000,
    channels=1,
    bit_depth=16
)
```

## Complete Example

```python
from stella_sdk import BaseAgent, AudioPipeline, VADConfig

class VoiceAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.pipeline = AudioPipeline(
            stt_provider="sherpa",
            tts_provider="kokoro",
            vad_config=VADConfig(
                threshold=0.5,
                min_silence_ms=700
            )
        )
        self.is_speaking = False

    async def on_connect(self):
        # Start listening for audio
        self.pipeline.on_speech_end = self.on_speech_detected
        await self.send_status("listening")

    async def on_speech_detected(self, audio: bytes):
        """Called when VAD detects end of speech."""
        if self.is_speaking:
            # User interrupted - stop speaking
            await self.pipeline.cancel_tts()
            self.is_speaking = False

        # Transcribe
        transcript = await self.pipeline.speech_to_text(audio)
        await self.send_transcript(transcript, speaker="user")

        # Generate response
        await self.send_status("thinking")
        response = await self.generate_response(transcript)

        # Speak response
        await self.send_status("speaking")
        self.is_speaking = True

        await self.send_transcript(response, speaker="assistant")

        async for chunk in self.pipeline.text_to_speech_stream(response):
            if not self.is_speaking:
                break  # Interrupted
            await self.publish_audio(chunk)

        self.is_speaking = False
        await self.send_status("listening")

    async def generate_response(self, text: str) -> str:
        # Your LLM logic
        pass
```

## See Also

- [Base Agent](./base-agent.md)
- [Message Types](./message-types.md)
- [Building Custom Agents](./building-custom-agent.md)

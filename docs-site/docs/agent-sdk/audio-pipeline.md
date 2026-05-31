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

### Qwen3-TTS (opt-in, real-time GPU, in-process)

Local Qwen3-TTS via [faster-qwen3-tts](https://github.com/andimarafioti/faster-qwen3-tts) —
a CUDA-graph-optimized runtime that hits ~156 ms TTFA on an RTX 4090 with the
0.6B-Base variant. The Qwen3-TTS weights are **Apache-2.0**, so this provider
is the recommended GPU option for commercial deployments.

- **Runs in-process** in the `tts-service` container (no sidecar, no HTTP
  hop). Selected at build time via `--build-arg TTS_PROVIDER=qwen3`; the
  resulting image carries only Qwen3's dependency tree (torch 2.5.1+cu124
  + `faster-qwen3-tts`).
- **Model variant is wizard-selectable** via `QWEN3_MODEL_ID`:
  - `Qwen/Qwen3-TTS-12Hz-0.6B-Base` (~2 GB VRAM, 156 ms TTFA on 4090) — recommended starting point
  - `Qwen/Qwen3-TTS-12Hz-1.7B-Base` (~5 GB VRAM, higher quality)
  - `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` (voice cloning from a reference clip)
  - `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` (instruction-based voice design)
- **Voice-clone API requires a reference WAV** for every variant (including
  Base). Place a 5–10 s clip on the model PVC and configure
  `QWEN3_REF_AUDIO` + `QWEN3_REF_TEXT`.

To enable Qwen3-TTS:

1. Pick `TTS_PROVIDER=qwen3` in the wizard and choose a `QWEN3_MODEL_ID`
   variant. Provide `QWEN3_REF_TEXT` (the transcript of your reference
   WAV). `HF_TOKEN` is optional for these Apache-2.0 weights.

2. Pre-stage a reference WAV at `QWEN3_REF_AUDIO`
   (default `/models/qwen3/ref_audio.mp3`) on the model PVC. STELLA
   bundles a German reference clip at `tts-service/assets/ref_audio.mp3`
   which the init container copies onto the PVC if you don't supply one.
   The model
   uses this to condition every utterance — supply a clean, short, single-
   speaker sample for best results.

3. Deploy with `./scripts/start-k8s.sh`. The build step compiles a
   Qwen3-only `tts-service` image; the init container downloads the
   weights to the shared PVC; the container loads them and captures CUDA
   graphs at startup (typically 30–90 s on an L4, including warm-up).

4. Tuning knobs (all optional):

   ```bash
   QWEN3_LANGUAGE=English        # input language label
   QWEN3_CHUNK_SIZE=2            # codec frames per yield (lower = lower TTFB)
   QWEN3_DTYPE=bfloat16          # bfloat16 / float16 / float32
   ```

```python
pipeline = AudioPipeline(
    tts_provider="qwen3",
)
```

**Pros:**
- Apache-2.0 weights — commercially usable.
- Real-time: 156 ms TTFA / 4.78 RTF on a 4090 with the 0.6B variant.
- Small VRAM footprint (~2 GB for 0.6B) leaves room next to STT on a 24 GB L4.
- In-process: no sidecar, no HTTP hop, no extra container to manage.

**Cons:**
- GPU-only. No CPU fallback path — use Piper or Kokoro for non-GPU deploys.
- The fast-path runtime is newer than vllm and has fewer eyes on it in
  production; expect to lean on logs for the first few rollouts.
- Requires an operator-supplied reference audio + transcript.

See `NOTICE.md` for the full license split between STELLA's permissive code,
the MIT-licensed `faster-qwen3-tts` engine, and the Apache-2.0 weights.

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

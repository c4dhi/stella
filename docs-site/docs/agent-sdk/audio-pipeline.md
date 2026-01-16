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

- [Base Agent](/docs/agent-sdk/base-agent)
- [Message Types](/docs/agent-sdk/message-types)
- [Building Custom Agents](/docs/agent-sdk/building-custom-agent)

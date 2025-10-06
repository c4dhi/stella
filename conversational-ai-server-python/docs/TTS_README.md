# 🎤 Modular TTS System

## Overview

The conversational AI server now includes a **modular TTS (Text-to-Speech) system** that supports multiple providers with consistent interfaces. This system provides:

- **Provider Transparency**: Switch between TTS providers without changing your code
- **Real-time Streaming**: Direct audio streaming to LiveKit frontend
- **Advanced Controls**: Pause, resume, and barge-in functionality
- **Easy Configuration**: Environment variable-based setup

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   TTSService    │────┤   AbstractTTS   │────┤   Providers     │
│   (Wrapper)     │    │   (Interface)   │    │                 │
├─────────────────┤    ├─────────────────┤    ├─────────────────┤
│ • process_text  │    │ • synthesize    │    │ • OpenSource    │
│ • pause/resume  │    │ • stream_audio  │    │ • ElevenLabs    │
│ • switch_provider│   │ • pause/resume  │    │ • Future: AWS   │
│ • health_check  │    │ • abandon       │    │ • Future: Azure │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🚀 Quick Start

### 1. Configuration

Set your TTS provider in your environment:

```bash
# For open source TTS (Edge TTS, Kokoro, pyttsx3)
export TTS_PROVIDER=opensource

# For ElevenLabs TTS
export TTS_PROVIDER=elevenlabs
export ELEVENLABS_API_KEY=your_api_key_here
```

### 2. Usage

The system maintains full backward compatibility - no code changes needed:

```python
# Your existing code continues to work
processor = MessageProcessor(room)
await processor.initialize_tts_audio_streaming()

# TTS automatically uses configured provider
await processor.tts_service.process_text_chunk("Hello world!")
await processor.tts_service.pause()
await processor.tts_service.resume()
```

## 📦 Supported Providers

### 🆓 Open Source Provider (`opensource`)

**Engines Included:**
- **Edge TTS** (Microsoft) - High quality cloud-based synthesis
- **Kokoro TTS** - Neural voice synthesis with multiple voices
- **pyttsx3** - System TTS fallback

**Features:**
- ✅ Real-time streaming
- ✅ Pause/resume with exact position
- ✅ Voice selection (Edge TTS, Kokoro)
- ✅ SSML support (Edge TTS)
- ✅ No API costs
- ✅ Automatic model download (Kokoro)

**Configuration:**
```bash
TTS_PROVIDER=opensource

# Optional Kokoro settings
KOKORO_MODEL_PATH=./models/kokoro-v1.0.onnx
KOKORO_VOICES_PATH=./models/voices-v1.0.bin
KOKORO_CACHE_DIR=/root/.cache/kokoro
```

### 🎙️ ElevenLabs Provider (`elevenlabs`)

**Features:**
- ✅ Premium voice quality
- ✅ Real-time websocket streaming
- ✅ Pause/resume with audio buffering
- ✅ 100+ premium voices
- ✅ Advanced voice controls
- ✅ SSML support
- 💰 API costs apply

**Configuration:**
```bash
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_api_key_here

# Optional settings
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # Rachel (default)
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5     # Fast streaming model
ELEVENLABS_STABILITY=0.5                  # Voice consistency
ELEVENLABS_SIMILARITY_BOOST=0.8           # Voice similarity
ELEVENLABS_STYLE=0.0                      # Style exaggeration
ELEVENLABS_USE_SPEAKER_BOOST=true         # Audio enhancement
```

## 🔧 Advanced Usage

### Provider Switching

```python
# Switch providers at runtime
success = await tts_service.switch_provider("elevenlabs")

# Get provider information
info = tts_service.get_provider_info()
print(f"Current provider: {info['provider_name']}")
print(f"Capabilities: {info['capabilities']}")
```

### Health Monitoring

```python
# Check provider health
health = tts_service.get_health_status()
if not health['service_healthy']:
    print("TTS service needs attention")

# Test connectivity
connectivity_ok = await tts_service.test_provider_connectivity()
```

### Voice Selection (ElevenLabs)

```python
# Use specific voice
await tts_service.synthesize_with_voice("Hello!", voice_id="pNInz6obpgDQGcFmaJgB")

# List available providers
providers = tts_service.get_available_providers()
for name, info in providers.items():
    print(f"{name}: {'✅' if info['is_configured'] else '❌'}")
```

## 🛠️ Development

### Adding New Providers

1. **Create Provider Class:**
```python
# tts/my_provider.py
class MyTTSProvider(AbstractTTSProvider):
    @property
    def provider_name(self) -> str:
        return "myprovider"

    async def synthesize_sentence(self, sentence: str) -> np.ndarray:
        # Implement synthesis
        pass
```

2. **Register in Factory:**
```python
# tts/factory.py
SUPPORTED_PROVIDERS = {
    "opensource": OpenSourceTTSProvider,
    "elevenlabs": ElevenLabsTTSProvider,
    "myprovider": MyTTSProvider,  # Add here
}
```

3. **Add Configuration:**
```python
provider_configs = {
    "myprovider": {
        "required_env_vars": ["MY_API_KEY"],
        "dependencies": ["my-tts-library"],
        "description": "My custom TTS provider"
    }
}
```

### Testing

```bash
# Run test suite
python test_tts_providers.py

# Test specific provider
TTS_PROVIDER=elevenlabs python test_tts_providers.py
```

## 📊 Feature Comparison

| Feature | OpenSource | ElevenLabs |
|---------|------------|------------|
| **Cost** | Free | Paid API |
| **Quality** | High | Premium |
| **Latency** | ~100ms | ~50ms |
| **Voices** | Limited | 100+ |
| **Streaming** | ✅ | ✅ |
| **Pause/Resume** | ✅ | ✅ |
| **Barge-in** | ✅ | ✅ |
| **SSML** | Edge TTS only | ✅ |
| **Offline** | Kokoro/pyttsx3 | ❌ |

## 🐛 Troubleshooting

### Common Issues

**1. ElevenLabs Not Working:**
```bash
# Check API key
echo $ELEVENLABS_API_KEY

# Check library installation
pip install elevenlabs>=1.0.0 websockets>=11.0.0
```

**2. Kokoro Models Not Downloading:**
```bash
# Check cache directory
ls ~/.cache/kokoro/
ls /root/.cache/kokoro/

# Manual download
mkdir -p ~/.cache/kokoro
cd ~/.cache/kokoro
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
wget https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

**3. Edge TTS Issues:**
```bash
# Update library
pip install edge-tts>=7.0.0

# Test directly
edge-tts --text "Hello" --write-media test.wav
```

### Debug Logging

```python
# Enable verbose logging
import logging
logging.basicConfig(level=logging.DEBUG)

# Check provider status
print(tts_service.get_health_status())
```

## 📈 Performance Tips

### For Optimal Latency:
1. **Use ElevenLabs turbo model:** `ELEVENLABS_MODEL_ID=eleven_turbo_v2_5`
2. **Enable websocket streaming** (automatic in ElevenLabs provider)
3. **Tune chunk sizes** in provider implementations
4. **Use lower stability** for faster synthesis: `ELEVENLABS_STABILITY=0.3`

### For Best Quality:
1. **Use ElevenLabs premium voices**
2. **Enable speaker boost:** `ELEVENLABS_USE_SPEAKER_BOOST=true`
3. **Use Edge TTS with neural voices** (opensource)
4. **Optimize similarity boost:** `ELEVENLABS_SIMILARITY_BOOST=0.8`

## 🔒 Security Notes

- **Never commit API keys** to version control
- **Use environment variables** for sensitive configuration
- **Rotate API keys** regularly
- **Monitor usage costs** for paid providers
- **Validate input text** before synthesis

## 🔄 Migration Guide

### From Old StreamingTTSService

The new system is **fully backward compatible**. No code changes required:

```python
# OLD (still works):
from message_processing.streaming_tts_service import StreamingTTSService
tts_service = StreamingTTSService(stream_service, room)

# NEW (recommended):
from tts.service import TTSService
tts_service = TTSService(stream_service, room, provider_name="opensource")
```

### Environment Variables

```bash
# NEW REQUIRED:
TTS_PROVIDER=opensource  # or "elevenlabs"

# FOR ELEVENLABS:
ELEVENLABS_API_KEY=your_key_here

# OPTIONAL:
ELEVENLABS_VOICE_ID=voice_id
ELEVENLABS_MODEL_ID=model_id
# ... other settings
```

## 🤝 Contributing

1. **Fork the repository**
2. **Create feature branch**: `git checkout -b feature/new-tts-provider`
3. **Add your provider** following the AbstractTTSProvider interface
4. **Add tests** in `test_tts_providers.py`
5. **Update documentation**
6. **Submit pull request**

## 📄 License

This TTS system is part of the conversational AI server project. See main project license for details.

---

**🎯 Ready to use?** Set your `TTS_PROVIDER` environment variable and start the server!
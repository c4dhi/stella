# Sherpa-ONNX Audio Transcription Setup

## Overview
The audio transcription system has been upgraded from faster-whisper to sherpa-onnx for improved streaming performance and integrated VAD.

## Installation

### 1. Install Dependencies
```bash
cd conversational-ai-server-python
pip install -r requirements.txt
```

This will install sherpa-onnx and other required dependencies.

### 2. Model Download (Automatic)
Sherpa-onnx models will be automatically downloaded on first use to `~/.cache/sherpa-onnx/`.

For manual download of a specific model:
```bash
# Example: Download a streaming English model
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20240104.tar.bz2
```

## Key Features

### ✅ **Streaming Transcription**
- Real-time audio processing (no batch delays)
- Partial transcripts sent to frontend immediately
- Integrated voice activity detection

### ✅ **Endpoint Detection**
- Automatic speech end detection
- Configurable silence thresholds
- Final transcript triggers processing pipeline

### ✅ **Resource Efficiency**
- Lighter CPU/memory usage vs Whisper + PyTorch
- No CUDA dependencies required
- Offline processing (no internet after model download)

## Configuration

### Audio Processing Settings
```python
# In audio_transcription.py
samples_per_chunk = 1600      # 0.1 seconds at 16kHz
vad_threshold = 0.2           # Lower = more sensitive
max_speech_duration = 20.0    # Maximum speech length
silence_duration = 2.0        # Silence before speech end
```

### Endpoint Detection
```python
# Sherpa-onnx endpoint configuration
rule1_min_trailing_silence=2.0    # Main silence threshold
rule2_min_trailing_silence=0.8    # Alternative silence threshold
rule3_min_utterance_length=1.0    # Minimum speech length
```

## Testing

### 1. Start the Server
```bash
python main.py
```

### 2. Check Initialization Logs
Look for these success messages:
```
[AudioTranscription] sherpa-onnx models initialized successfully
[AudioTranscription] Processing loop started
```

### 3. Test Audio Streaming
- Connect frontend client
- Start speaking into microphone
- Verify partial transcripts appear in real-time
- Confirm final transcripts trigger AI processing

## Troubleshooting

### Model Loading Issues
If model initialization fails, check:
1. Internet connection for initial download
2. Disk space in `~/.cache/sherpa-onnx/`
3. Model file integrity

### Performance Issues
- Reduce `samples_per_chunk` for lower latency
- Increase `vad_threshold` to reduce false positives
- Adjust `silence_duration` for faster/slower endpoint detection

### Memory Usage
- Each session creates its own recognizer instance
- Sessions auto-cleanup after 30 seconds of inactivity
- Manual cleanup via `stop_session()` or service restart

## Migration Notes

### Removed Dependencies
- ✅ faster-whisper
- ✅ silero-vad
- ✅ torch
- ✅ librosa

### Added Dependencies
- ✅ sherpa-onnx (single package)
- ✅ numpy (retained)

### Interface Compatibility
- ✅ Same `StreamService` integration
- ✅ Same message processing pipeline
- ✅ Same frontend audio streaming protocol
- ✅ Same session management
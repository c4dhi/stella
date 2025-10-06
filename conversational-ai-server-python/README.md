# Python AI Server with Dynamic Agent System

A sophisticated Python-based conversational AI server that implements the same message processing pipeline as the NestJS version, with dynamic agent discovery and LangChain orchestration.

## 🚀 Key Features

- **Dynamic Agent Discovery**: Add new expert agents by simply dropping JSON configs in the `agents/` folder
- **Streaming Input Gate**: Real-time decision making with [SAFE]/[COMPLEX] routing
- **LangChain Integration**: Professional agent orchestration framework
- **Token-by-Token Streaming**: Real-time response delivery to frontend
- **Expert Pool System**: Parallel expert analysis with configurable agents
- **Conflict Resolution**: Intelligent synthesis of multiple expert opinions
- **Real-time Audio Transcription**: sherpa-onnx powered speech-to-text with German support
- **Step-by-Step Plans**: Execute multi-step conversation flows with deliverable tracking
- **Persistent Model Storage**: One-time model download with Docker volume persistence
- **TTS Support**: Multiple text-to-speech providers (ElevenLabs, OpenSource/Edge TTS)

## 🏗️ Architecture

```
┌─────────────────────┐    Message     ┌──────────────────────┐
│  Frontend           │──────────────►│  Python AI Server   │
│  (LiveKit Client)   │                │                      │
└─────────────────────┘                │  ┌─────────────────┐ │
                                       │  │ Input Gate      │ │
                                       │  │ [SAFE/COMPLEX]  │ │
                                       │  └─────────────────┘ │
                                       │           │           │
                                       │  ┌─────────────────┐ │
                                       │  │ Expert Pool     │ │
                                       │  │ - Medical       │ │
                                       │  │ - Legal         │ │
                                       │  │ - Ethics        │ │
                                       │  │ - Coding        │ │
                                       │  │ - Finance       │ │
                                       │  └─────────────────┘ │
                                       │           │           │
                                       │  ┌─────────────────┐ │
                                       │  │ Aggregator      │ │
                                       │  │ (Synthesis)     │ │
                                       │  └─────────────────┘ │
                                       └──────────────────────┘
```

## 🎤 Audio Transcription Models

The system supports real-time speech-to-text using **sherpa-onnx** with multiple model options:

### 🏆 Recommended: NeMo Canary (Multilingual German Support)
- **Model**: `sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8`
- **Languages**: English + Spanish + **German** + French
- **Size**: ~700MB
- **Quality**: Ranked 9th on HuggingFace OpenASR leaderboard
- **Streaming**: ✅ Optimized for real-time transcription
- **Mac Compatible**: ✅ Works on Apple Silicon (M1/M2/M3)

### 🌐 Alternative: Whisper Multilingual Models
- **Models**: `tiny`, `base`, `small`, `medium` (all multilingual)
- **Languages**: German + 90+ other languages
- **Streaming**: ✅ Adapted for real-time use
- **Tradeoff**: Larger models = better quality, slower processing

### 🔧 Current Model Configuration
The system currently uses `sherpa-onnx-streaming-zipformer-en-2023-06-21` (English-optimized) but can be easily switched to German-supporting models by updating the model name in `message_processing/audio_transcription.py`.

### 💻 Platform Compatibility
- ✅ **Linux**: Full support (Docker recommended)
- ✅ **macOS**: Intel and Apple Silicon (M1/M2/M3) support
- ✅ **Windows**: Supported via Docker or native installation

## 💾 Model Persistence (No Re-downloads!)

The Sherpa-ONNX models are large (~180-700MB) and by default would download on every container restart. We've implemented a persistent storage solution:

### One-Time Setup
```bash
# Download the model once to local storage
python3 download_sherpa_model.py
```

This creates a `sherpa-models/` directory that's mounted into the Docker container, eliminating repeated downloads.

### How It Works
- Models are stored in `./sherpa-models/` on your host machine
- Docker mounts this directory to the container's cache location
- The container checks for existing models before downloading
- Models persist across container restarts, rebuilds, and removals

See [SHERPA_MODEL_SETUP.md](./SHERPA_MODEL_SETUP.md) for detailed setup instructions.

## 📁 Project Structure

```
conversational-ai-server-python/
├── main.py                          # Main server entry point
├── message_processing/              # Core AI processing modules
│   ├── __init__.py
│   ├── processor.py                 # Main orchestrator
│   ├── input_gate.py               # Streaming decision gate
│   ├── expert_pool.py              # Dynamic agent pool
│   ├── aggregator.py               # Expert synthesis
│   ├── audio_transcription.py      # Real-time speech-to-text
│   ├── simple_audio_transcription.py # Sherpa-based transcription
│   ├── plan_service.py            # Plan execution service
│   ├── plan_state_manager.py      # Plan state management
│   └── stream_service.py           # LiveKit messaging
├── agents/                         # Auto-discovered agent configs
│   ├── medical.json               # Medical safety expert
│   ├── legal.json                 # Legal compliance expert
│   ├── ethics.json                # Ethics review expert
│   ├── coding.json                # Code analysis expert
│   └── finance.json               # Financial analysis expert
├── plans/                          # Step-by-step plan definitions
├── sherpa-models/                  # Persistent model storage (git-ignored)
├── requirements.txt                # Python dependencies
├── Dockerfile                      # Container configuration
├── docker-compose.yml             # Docker orchestration with volumes
├── download_sherpa_model.py       # One-time model download script
├── SHERPA_MODEL_SETUP.md          # Model persistence documentation
├── .gitignore                     # Excludes large model files
└── .env                           # Environment variables
```

## 🔧 Setup Instructions

### 1. Environment Configuration

Copy and update the environment file:
```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
# LiveKit Connection
LIVEKIT_URL=ws://localhost:7880
ROOM_NAME=voice-ai-room
IDENTITY=python-ai-server

# LiveKit Credentials (must match main server)
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret

# OpenAI Configuration
OPENAI_API_KEY=your-actual-openai-api-key-here

# TTS Configuration (optional)
TTS_PROVIDER=opensource  # or "elevenlabs"
ELEVENLABS_API_KEY=your-elevenlabs-key  # if using ElevenLabs
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # optional voice selection
```

### 2. Download Sherpa Model (One-time setup)

```bash
# Download the speech recognition model to avoid repeated downloads
python3 download_sherpa_model.py
```

This step is optional but highly recommended. It downloads the model once and stores it locally, preventing re-downloads on every container restart.

### 3. Local Development Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Run the server
python main.py
```

### 4. Docker Setup (Recommended)

```bash
# Build and run with Docker Compose
docker-compose up --build

# Or build and run manually
docker build -t python-ai-server .
docker run --env-file .env --network host python-ai-server
```

The Docker setup automatically uses the pre-downloaded Sherpa model if available, thanks to the volume mount in `docker-compose.yml`.

### 5. Switching to German Audio Transcription

To enable German language support, update the model in `message_processing/audio_transcription.py`:

```python
# Change line 59 from:
model_name = "sherpa-onnx-streaming-zipformer-en-2023-06-21"

# To (for best German support):
model_name = "sherpa-onnx-nemo-canary-180m-flash-en-es-de-fr-int8"

# Or for Whisper multilingual:
model_name = "sherpa-onnx-whisper-base"  # or tiny, small, medium
```

Then rebuild the Docker container:
```bash
docker-compose down
docker-compose up --build
```

The new model will be automatically downloaded on first startup (~700MB for Canary model).

## 🤖 Adding New Agents (Zero Code Required!)

To add a new expert agent, simply create a JSON configuration file in the `agents/` folder:

### Example: Adding a Cooking Safety Agent

Create `agents/cooking.json`:
```json
{
  "name": "cooking",
  "description": "Food safety and cooking expert",
  "trigger_keywords": ["cook", "food", "recipe", "ingredients", "temperature", "safety"],
  "system_prompt": "You are a food safety expert. Focus on safe cooking practices, temperature guidelines, and food handling safety. Always prioritize food safety and proper hygiene.",
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "max_tokens": 800,
  "risk_threshold": 0.2,
  "relevant_intents": ["question", "request"],
  "tools": ["food_safety_check", "temperature_lookup"]
}
```

**That's it!** The system will automatically:
1. Discover the new agent on startup
2. Load its configuration
3. Use it when cooking-related queries are received
4. **No code changes or restarts needed in development**

### Agent Configuration Reference

| Field | Description | Required |
|-------|-------------|----------|
| `name` | Unique agent identifier | ✅ |
| `description` | Human-readable description | ✅ |
| `trigger_keywords` | Keywords that activate this agent | ✅ |
| `system_prompt` | Agent's system instructions | ✅ |
| `model` | OpenAI model to use | ❌ (default: gpt-4o-mini) |
| `temperature` | Response creativity (0.0-1.0) | ❌ (default: 0.3) |
| `max_tokens` | Maximum response length | ❌ (default: 800) |
| `risk_threshold` | Risk score threshold (0.0-1.0) | ❌ (default: 0.3) |
| `relevant_intents` | Intent types to handle | ❌ |
| `tools` | Available tools (future feature) | ❌ |

## 🔄 Message Processing Flow

### 1. Simple Query (SAFE Route)
```
User: "What's the weather like?"
│
├─► Input Gate: [SAFE] → "Let me check that for you..."
└─► Response streamed directly (no expert analysis needed)
```

### 2. Complex Query (COMPLEX Route)
```
User: "Is it safe to take aspirin with my blood pressure medication?"
│
├─► Input Gate: [COMPLEX] → "Let me think about this..."
├─► Expert Selection: Medical + Ethics agents
├─► Parallel Analysis: Both agents analyze simultaneously
├─► Conflict Resolution: Aggregator synthesizes findings
└─► Streaming Response: "Based on medical safety analysis..."
```

## 📊 Monitoring and Debugging

The system provides detailed logging for monitoring:

```bash
# View agent discovery
[ExpertPool] Discovered 5 agents: ['medical', 'legal', 'ethics', 'coding', 'finance']

# Monitor message processing
[MessageProcessor] Processing message from user_123: "Can I invest in crypto?"
[MessageProcessor] Gate decision: COMPLEX (confidence: 0.85)
[MessageProcessor] Selected 2 agents for analysis: ['finance', 'ethics']
[ExpertPool] Running 2 experts: ['finance', 'ethics']
[MessageProcessor] Complex route completed (confidence: 0.78)
```

## 🧪 Testing New Agents

Test your agent configurations quickly:

```python
# Check if agent loads correctly
python -c "
from message_processing.expert_pool import ExpertPool
from message_processing.stream_service import StreamService
import rtc

pool = ExpertPool(StreamService(None))
print(f'Loaded agents: {list(pool.agents.keys())}')
"

# Test agent selection
python -c "
pool = ExpertPool(StreamService(None))
relevant = pool.select_relevant_agents('How do I cook chicken safely?', 'question', 0.3)
print(f'Selected agents: {relevant}')
"
```

## 🚀 Deployment

### Production Environment Variables

```env
# Production LiveKit server
LIVEKIT_URL=wss://your-livekit-server.com
LIVEKIT_API_KEY=your-production-key
LIVEKIT_API_SECRET=your-production-secret

# Production OpenAI
OPENAI_API_KEY=your-production-openai-key

# Optional performance tuning
PYTHONUNBUFFERED=1
PYTHONPATH=/app
```

### Scaling Considerations

1. **Agent Performance**: Each agent runs in parallel, scaling horizontally
2. **Memory Management**: Conversation history is limited to last 20 messages
3. **Rate Limiting**: Consider OpenAI API limits with multiple agents
4. **Monitoring**: All decisions and expert status are streamed to frontend

## 🔧 Troubleshooting

### Common Issues

1. **"No agents discovered"**
   - Check that `agents/` folder exists
   - Verify JSON syntax in agent files
   - Check file permissions

2. **"OpenAI API key not configured"**
   - Set `OPENAI_API_KEY` in `.env` file
   - Restart the server after updating `.env`

3. **"Failed to connect to LiveKit"**
   - Verify LiveKit server is running
   - Check `LIVEKIT_URL` is correct
   - Ensure API key/secret match LiveKit server

4. **"Expert analysis failed"**
   - Check OpenAI API quota
   - Verify internet connectivity
   - Check agent configuration syntax

5. **"Downloading model: sherpa-onnx..." on every startup**
   - Run `python3 download_sherpa_model.py` to pre-download the model
   - Check if `sherpa-models/` directory exists with the model files
   - Ensure Docker has read permissions: `chmod -R 755 sherpa-models/`
   - Verify the volume mount in `docker-compose.yml` is correct

### Debug Mode

Enable debug logging:
```bash
export PYTHONUNBUFFERED=1
python -u main.py
```

## 🤝 Contributing

To add new functionality:

1. **New Agent Type**: Just add a JSON config file
2. **New Expert Tools**: Extend the `tools` array in agent configs
3. **Custom Processing**: Modify the pipeline in `processor.py`

The system is designed for maximum extensibility with minimal code changes.

## 📝 License

This project follows the same license as the main voice-ai-agents repository.
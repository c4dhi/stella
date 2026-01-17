---
sidebar_position: 2
title: Data Flow
description: How messages flow through the STELLA system
---

# Data Flow

Understanding how data flows through STELLA helps when debugging issues or extending the system. This document traces the path of a user's voice input from the browser to the AI response.

## Voice Conversation Flow

```
┌──────────┐     ┌─────────┐     ┌─────────┐     ┌───────┐     ┌─────┐
│  User    │────▶│ Browser │────▶│ LiveKit │────▶│ Agent │────▶│ LLM │
│ (Voice)  │     │ (WebRTC)│     │ Server  │     │ (STT) │     │     │
└──────────┘     └─────────┘     └─────────┘     └───────┘     └─────┘
                                                     │            │
                                                     │            ▼
┌──────────┐     ┌─────────┐     ┌─────────┐     ┌───────┐     ┌─────┐
│  User    │◀────│ Browser │◀────│ LiveKit │◀────│ Agent │◀────│ LLM │
│ (Hears)  │     │ (Audio) │     │ Server  │     │ (TTS) │     │     │
└──────────┘     └─────────┘     └─────────┘     └───────┘     └─────┘
```

## Step-by-Step Breakdown

### 1. User Speaks

The user speaks into their microphone. The browser captures the audio using the Web Audio API.

```javascript
// Browser captures audio
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    // Stream is connected to LiveKit
    room.localParticipant.publishTrack(stream.getAudioTracks()[0]);
  });
```

### 2. WebRTC Transport

The browser encodes the audio using Opus codec and sends it via WebRTC to the LiveKit server.

**Key characteristics:**
- Low latency (50-150ms typical)
- Adaptive bitrate
- Encrypted transport (DTLS-SRTP)

### 3. LiveKit Routing

LiveKit receives the audio and routes it to all participants in the room, including the agent pod.

```
User Audio ──▶ LiveKit ──▶ Agent Pod
                 │
                 └──▶ Other Participants (if any)
```

### 4. Speech-to-Text (STT)

The agent receives the audio stream and processes it through the STT engine.

```python
# Agent receives audio from LiveKit
async def on_audio_frame(self, frame: AudioFrame):
    # Process through STT pipeline
    text = await self.pipeline.transcribe(frame)

    if text.is_final:
        await self.on_transcript(text.text, is_final=True)
```

**STT Options:**
- **Sherpa-ONNX**: Local, low-latency, runs on CPU
- **Whisper**: Higher accuracy, can run locally or via API
- **Cloud STT**: Google, Azure, AWS speech services

### 5. LLM Processing

The transcribed text is sent to the LLM along with conversation history and system context.

```python
async def generate_response(self, user_input: str) -> str:
    messages = [
        {"role": "system", "content": self.system_prompt},
        *self.conversation_history,
        {"role": "user", "content": user_input}
    ]

    response = await self.openai.chat.completions.create(
        model="gpt-4o",
        messages=messages,
        tools=self.get_tool_definitions()
    )

    return response.choices[0].message.content
```

### 6. Tool Execution (Optional)

If the LLM wants to use a tool, the agent executes it and feeds results back to the LLM.

```python
# LLM requests a tool call
tool_call = response.choices[0].message.tool_calls[0]

# Agent executes the tool
result = await self.execute_tool(
    tool_call.function.name,
    json.loads(tool_call.function.arguments)
)

# Feed result back to LLM for final response
```

### 7. Text-to-Speech (TTS)

The LLM's response is converted to audio through the TTS engine.

```python
async def speak(self, text: str):
    # Stream TTS output
    async for audio_chunk in self.pipeline.text_to_speech_stream(text):
        # Publish to LiveKit room
        await self.publish_audio(audio_chunk)
```

**TTS Options:**
- **Kokoro**: Local, fast, good quality
- **Piper**: Local, multiple voices
- **ElevenLabs**: Cloud, very natural voices
- **OpenAI TTS**: Cloud, simple integration

### 8. Audio Delivery

The TTS audio is published to LiveKit and routed back to the user's browser.

```
Agent TTS Audio ──▶ LiveKit ──▶ User's Browser ──▶ Speakers
```

## Data Channel Messages

In addition to audio, STELLA uses LiveKit data channels for text-based communication.

### Message Types

```typescript
// Transcript message (interim and final)
{
  type: "transcript",
  speaker: "user" | "assistant",
  text: "Hello, how can I help?",
  isFinal: true,
  timestamp: 1699876543210
}

// Status update
{
  type: "status",
  status: "thinking" | "speaking" | "listening",
  message: "Searching the database..."
}

// Progress update
{
  type: "progress",
  todos: [
    { id: "1", description: "Search database", status: "completed" },
    { id: "2", description: "Generate response", status: "in_progress" }
  ]
}
```

### Flow Diagram

```
┌──────────┐                      ┌──────────┐
│ Frontend │                      │  Agent   │
└────┬─────┘                      └────┬─────┘
     │                                 │
     │──── User types message ────────▶│
     │                                 │
     │◀─── status: "thinking" ─────────│
     │                                 │
     │◀─── transcript (interim) ───────│
     │                                 │
     │◀─── transcript (final) ─────────│
     │                                 │
     │◀─── status: "listening" ────────│
     │                                 │
```

## Database Persistence

All messages are persisted to PostgreSQL for history and analytics.

```sql
-- Messages table structure
CREATE TABLE messages (
  id            UUID PRIMARY KEY,
  session_id    UUID REFERENCES sessions(id),
  speaker       VARCHAR(20),  -- 'user' or 'assistant'
  content       TEXT,
  timestamp     TIMESTAMP WITH TIME ZONE,
  metadata      JSONB
);
```

### Write Path

1. Agent generates response
2. Backend receives message via WebSocket
3. Message saved to PostgreSQL
4. Message broadcast to all connected clients

### Read Path

1. Client requests session history
2. Backend queries PostgreSQL
3. Messages returned in chronological order

## Latency Considerations

| Stage | Typical Latency | Notes |
|-------|----------------|-------|
| Audio Capture | ~10ms | Browser processing |
| WebRTC Transport | 50-150ms | Network dependent |
| STT Processing | 100-500ms | Model and hardware dependent |
| LLM Generation | 500-3000ms | Model and prompt dependent |
| TTS Generation | 100-500ms | Streaming reduces perceived latency |
| Audio Playback | ~10ms | Browser processing |

**Total typical latency: 800ms - 4000ms**

### Latency Optimization

1. **Streaming TTS**: Start speaking before full response is generated
2. **Local STT**: Use Sherpa-ONNX instead of cloud APIs
3. **Edge deployment**: Run agents closer to users
4. **Response caching**: Cache common responses

## Next Steps

- [Session Lifecycle](/docs/architecture/session-lifecycle) - Session states
- [Kubernetes Orchestration](/docs/architecture/kubernetes-orchestration) - Pod management

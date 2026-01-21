---
sidebar_position: 4
title: "🔊 echo-agent"
---

# 🔊 echo-agent

A simple test agent that echoes back messages for development and debugging.

## Overview

`echo-agent` is a minimal agent implementation used for:

- Testing LiveKit connectivity
- Verifying audio pipeline works
- Development and debugging
- Integration testing

## How It Works

The echo agent:
1. Receives audio from the LiveKit room
2. Transcribes the audio using STT
3. Echoes the transcription back as text
4. (Optionally) Synthesizes the text as audio

```
Audio In → STT → Echo Text → (Optional TTS) → Audio Out
```

## Use Cases

### Testing LiveKit Connection

Verify that your LiveKit server is properly configured:

```bash
# Deploy echo agent
curl -X POST http://localhost:3000/sessions/{sessionId}/agents \
  -H "Content-Type: application/json" \
  -d '{"role": "echo-agent"}'

# Speak into microphone
# Agent should repeat what you said
```

### Verifying Audio Pipeline

Check that audio is being captured and transmitted:

1. Deploy echo-agent
2. Speak clearly
3. Verify you hear your words echoed back
4. Check transcription appears in the UI

### Debugging Data Channel

Test data channel messaging:

```javascript
// Send a test message
const data = {
  type: 'user_text',
  data: 'Hello Echo!'
};
room.localParticipant.publishData(
  new TextEncoder().encode(JSON.stringify(data)),
  { reliable: true }
);

// Echo agent will respond with the same message
```

## Configuration

Minimal configuration required:

| Variable | Description | Required |
|----------|-------------|----------|
| `LIVEKIT_URL` | LiveKit server URL | Yes |
| `LIVEKIT_API_KEY` | LiveKit API key | Yes |
| `LIVEKIT_API_SECRET` | LiveKit API secret | Yes |
| `STT_PROVIDER` | Speech-to-text provider | Optional |
| `ECHO_MODE` | `text`, `audio`, or `both` | Optional (`text`) |

## Echo Modes

### Text Mode (Default)

Returns transcribed text via data channel only:

```typescript
// Received message
{
  type: 'echo_response',
  data: {
    original: 'Hello world',
    echoed: 'Echo: Hello world',
    timestamp: '2024-01-15T10:30:00Z'
  }
}
```

### Audio Mode

Echoes audio back without processing:

- Receives audio stream
- Transmits back as-is
- Useful for latency testing

### Both Mode

Transcribes, echoes text, and synthesizes audio response:

- Full pipeline test
- Most comprehensive verification

## Resource Requirements

| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 50m | 200m |
| Memory | 128Mi | 512Mi |

## Deployment

### Via API

```bash
curl -X POST http://localhost:3000/sessions/{sessionId}/agents \
  -H "Content-Type: application/json" \
  -d '{
    "role": "echo-agent",
    "config": {
      "echoMode": "both"
    }
  }'
```

### Via Frontend

1. Create or open a session
2. Click "Deploy Agent"
3. Select "echo-agent" from the dropdown
4. Deploy

## Troubleshooting

### No Echo Response

1. Check LiveKit connection:
   ```bash
   kubectl logs <echo-agent-pod> -n ai-agents
   ```

2. Verify room exists:
   ```bash
   curl http://localhost:7880/rooms
   ```

3. Check audio track is published:
   - Open browser DevTools
   - Check Network tab for WebRTC connections

### Delayed Echo

1. Check STT service latency
2. Verify network connectivity
3. Check pod resource usage:
   ```bash
   kubectl top pod <echo-agent-pod> -n ai-agents
   ```

### Garbled Audio

1. Check sample rate settings
2. Verify audio codec compatibility
3. Test with text-only mode first

## Development Use

Echo agent is useful during development for:

```python
# Quick connection test
async def test_connection():
    agent = EchoAgent()
    await agent.connect(room_name="test-room")
    # If you hear echo, connection works
    await agent.disconnect()
```

## See Also

- [Agents Overview](/docs/agents/overview) - All agent types
- [LiveKit Integration](/docs/integration/livekit) - LiveKit setup
- [First Agent](/docs/getting-started/first-agent) - Deployment guide

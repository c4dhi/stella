---
sidebar_position: 1
title: LiveKit
---

# LiveKit Integration

Guide for integrating LiveKit client in your frontend to connect to STELLA sessions.

## Overview

STELLA uses LiveKit for real-time WebRTC communication. The frontend connects to LiveKit rooms to:
- Send/receive audio from agents
- Exchange data messages (transcripts, status updates)
- Track participant presence

## Installation

```bash
npm install livekit-client
# or
yarn add livekit-client
```

## Basic Connection

### 1. Get Join Token from Backend

```typescript
async function getJoinToken(sessionId: string, userId: string, userName: string) {
  const response = await fetch(`/api/sessions/${sessionId}/joinToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: userId,
      name: userName,
    }),
  });

  return response.json(); // { token, serverUrl, roomName }
}
```

### 2. Connect to LiveKit Room

```typescript
import { Room } from 'livekit-client';

async function connectToSession(sessionId: string, userId: string, userName: string) {
  // Get token from backend
  const { token, serverUrl } = await getJoinToken(sessionId, userId, userName);

  // Create room instance
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  });

  // Set up event listeners BEFORE connecting
  room.on('connected', () => {
    console.log('Connected to room!');
  });

  room.on('disconnected', () => {
    console.log('Disconnected from room');
  });

  // Connect to room
  await room.connect(serverUrl, token);

  return room;
}
```

## Audio Integration

### Enable Microphone

```typescript
import { Room, RoomEvent, Track } from 'livekit-client';

async function enableMicrophone(room: Room) {
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
    console.log('Microphone enabled');
  } catch (error) {
    console.error('Failed to enable microphone:', error);
    throw error;
  }
}
```

### Receive Audio from Agent

```typescript
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind === Track.Kind.Audio) {
    // Agent's audio track
    const audioElement = track.attach();
    document.body.appendChild(audioElement);

    console.log(`Subscribed to ${participant.identity}'s audio`);
  }
});
```

### Audio Volume Meter

```typescript
function setupVolumeMonitoring(room: Room) {
  const audioContext = new AudioContext();

  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    if (publication.kind === Track.Kind.Audio && publication.track) {
      const mediaStream = new MediaStream([publication.track.mediaStreamTrack]);
      const source = audioContext.createMediaStreamSource(mediaStream);
      const analyser = audioContext.createAnalyser();

      source.connect(analyser);
      analyser.fftSize = 256;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      function updateVolume() {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
        const volume = average / 255; // 0-1

        // Update UI with volume
        updateVolumeUI(volume);
        requestAnimationFrame(updateVolume);
      }

      updateVolume();
    }
  });
}
```

## Data Channel Communication

### Send Text Messages

```typescript
async function sendTextMessage(room: Room, message: string) {
  const data = {
    type: 'user_text',
    data: message,
  };

  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(data));

  await room.localParticipant.publishData(encodedData, {
    reliable: true, // Guaranteed delivery
  });
}
```

### Receive Data Messages

```typescript
room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant) => {
  const decoder = new TextDecoder();
  const jsonString = decoder.decode(payload);

  try {
    const message = JSON.parse(jsonString);

    switch (message.type) {
      case 'transcript_chunk':
        handleTranscript(message.data);
        break;
      case 'agent_status':
        handleAgentStatus(message.data);
        break;
      case 'todo_list':
        handleTodoList(message.data);
        break;
    }
  } catch (error) {
    console.error('Failed to parse data message:', error);
  }
});
```

## Message Types

### Transcript Chunk

```typescript
interface TranscriptChunk {
  type: 'transcript_chunk';
  data: {
    text: string;
    is_final: boolean;
    confidence: number;
    timestamp: string;
    participant_id: string;
    chunk_id: string;
    transcript_id: string;
  };
}
```

### Agent Status

```typescript
interface AgentStatus {
  type: 'agent_status';
  data: {
    status: 'listening' | 'thinking' | 'speaking';
    message?: string;
  };
}
```

### Todo List

```typescript
interface TodoList {
  type: 'todo_list';
  data: {
    items: Array<{
      id: string;
      description: string;
      status: 'pending' | 'in_progress' | 'completed';
      required: boolean;
    }>;
    timestamp: string;
  };
}
```

## React Integration

### Custom Hook

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

interface UseSessionOptions {
  sessionId: string;
  userId: string;
  userName: string;
  onTranscript?: (data: any) => void;
  onTodoList?: (data: any) => void;
  onAgentStatus?: (data: any) => void;
}

export function useSession(options: UseSessionOptions) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);

  useEffect(() => {
    let currentRoom: Room | null = null;

    async function connect() {
      const response = await fetch(
        `/api/sessions/${options.sessionId}/joinToken`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: options.userId,
            name: options.userName,
          }),
        }
      );
      const { token, serverUrl } = await response.json();

      currentRoom = new Room();

      currentRoom.on(RoomEvent.Connected, () => setConnected(true));
      currentRoom.on(RoomEvent.Disconnected, () => setConnected(false));

      currentRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        setParticipants((prev) => [...prev, participant.identity]);
      });

      currentRoom.on(RoomEvent.ParticipantDisconnected, (participant) => {
        setParticipants((prev) =>
          prev.filter((id) => id !== participant.identity)
        );
      });

      currentRoom.on(RoomEvent.DataReceived, (payload) => {
        const decoder = new TextDecoder();
        const message = JSON.parse(decoder.decode(payload));

        if (message.type === 'transcript_chunk') {
          options.onTranscript?.(message.data);
        } else if (message.type === 'todo_list') {
          options.onTodoList?.(message.data);
        } else if (message.type === 'agent_status') {
          options.onAgentStatus?.(message.data);
        }
      });

      await currentRoom.connect(serverUrl, token);
      await currentRoom.localParticipant.setMicrophoneEnabled(true);
      setMicEnabled(true);
      setRoom(currentRoom);
    }

    connect();

    return () => {
      currentRoom?.disconnect();
    };
  }, [options.sessionId, options.userId, options.userName]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!room) return;

      const data = { type: 'user_text', data: text };
      const encoder = new TextEncoder();
      await room.localParticipant.publishData(
        encoder.encode(JSON.stringify(data)),
        { reliable: true }
      );
    },
    [room]
  );

  const toggleMicrophone = useCallback(async () => {
    if (!room) return;

    const newState = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(newState);
    setMicEnabled(newState);
  }, [room, micEnabled]);

  return {
    connected,
    participants,
    micEnabled,
    sendMessage,
    toggleMicrophone,
  };
}
```

### Component Example

```typescript
function SessionView({ sessionId }: { sessionId: string }) {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');

  const { connected, micEnabled, sendMessage, toggleMicrophone } = useSession({
    sessionId,
    userId: 'user-123',
    userName: 'John Doe',
    onTranscript: (data) => {
      if (data.is_final) {
        setMessages((prev) => [...prev, data.text]);
      }
    },
  });

  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };

  return (
    <div>
      <div>Status: {connected ? 'Connected' : 'Disconnected'}</div>

      <button onClick={toggleMicrophone}>
        {micEnabled ? 'Mute' : 'Unmute'}
      </button>

      <div>
        {messages.map((msg, i) => (
          <div key={i}>{msg}</div>
        ))}
      </div>

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
      />
      <button onClick={handleSend}>Send</button>
    </div>
  );
}
```

## Troubleshooting

### Connection Issues

```typescript
room.on(RoomEvent.ConnectionStateChanged, (state) => {
  console.log('Connection state:', state);
});

room.on(RoomEvent.Reconnecting, () => {
  console.log('Reconnecting...');
});

room.on(RoomEvent.Reconnected, () => {
  console.log('Reconnected!');
});
```

### Microphone Permission Denied

```typescript
async function requestMicrophonePermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      alert('Microphone permission denied');
    }
    return false;
  }
}
```

### Audio Not Playing

```typescript
room.on(RoomEvent.TrackSubscribed, (track) => {
  if (track.kind === Track.Kind.Audio) {
    const element = track.attach();

    // Handle autoplay restrictions
    element.play().catch((error) => {
      console.log('Autoplay prevented:', error);
      // Show "Click to enable audio" button
    });

    document.body.appendChild(element);
  }
});
```

## Best Practices

1. **Always disconnect on unmount** to free resources
2. **Request microphone permission early** for better UX
3. **Use reliable: true for important messages** (transcripts, commands)
4. **Handle reconnection gracefully** with loading states
5. **Provide visual feedback** for connection status
6. **Implement error boundaries** for LiveKit errors

## See Also

- [LiveKit Production](/docs/integration/livekit-production)
- [Message Types](/docs/agent-sdk/message-types)
- [First Agent](/docs/getting-started/first-agent)

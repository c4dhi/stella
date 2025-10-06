# LiveKit Frontend Integration Guide

Complete guide for integrating LiveKit client in your frontend to connect to sessions.

## Table of Contents

- [Installation](#installation)
- [Basic Connection](#basic-connection)
- [Audio Integration](#audio-integration)
- [Data Channel Communication](#data-channel-communication)
- [Complete Example](#complete-example)
- [React Integration](#react-integration)
- [Troubleshooting](#troubleshooting)

## Installation

```bash
npm install livekit-client
# or
yarn add livekit-client
```

## Basic Connection

### 1. Get Join Token from Session Management Server

```typescript
import { apiClient } from './config/api';

async function getJoinToken(sessionId: string, userId: string, userName: string) {
  const response = await apiClient.post(`/sessions/${sessionId}/joinToken`, {
    identity: userId,
    name: userName,
  });

  return response; // { token, serverUrl, roomName }
}
```

### 2. Connect to LiveKit Room

```typescript
import { Room } from 'livekit-client';

async function connectToSession(sessionId: string, userId: string, userName: string) {
  // Get token from session management server
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
    // Create local audio track from microphone
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
  // Monitor local microphone volume
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

    // Handle different message types
    if (message.type === 'transcript_chunk') {
      handleTranscript(message.data);
    } else if (message.type === 'agent_response') {
      handleAgentResponse(message.data);
    } else if (message.type === 'todo_list') {
      handleTodoList(message.data);
    }
  } catch (error) {
    console.error('Failed to parse data message:', error);
  }
});
```

### Message Types from Conversational AI Agent

The Python conversational AI agent sends these message types:

```typescript
// Transcript chunk (user speech or agent responses)
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

// Todo list updates
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

// Agent status
interface AgentStatus {
  type: 'agent_status';
  data: {
    status: string;
    message?: string;
  };
}
```

## Complete Example

```typescript
import { Room, RoomEvent, Track } from 'livekit-client';

class SessionClient {
  private room: Room | null = null;
  private sessionId: string;
  private userId: string;
  private userName: string;

  constructor(sessionId: string, userId: string, userName: string) {
    this.sessionId = sessionId;
    this.userId = userId;
    this.userName = userName;
  }

  async connect() {
    // Get join token
    const { token, serverUrl } = await fetch(
      `/api/sessions/${this.sessionId}/joinToken`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: this.userId,
          name: this.userName,
        }),
      }
    ).then((res) => res.json());

    // Create and configure room
    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });

    // Set up event listeners
    this.setupEventListeners();

    // Connect
    await this.room.connect(serverUrl, token);

    // Enable microphone
    await this.room.localParticipant.setMicrophoneEnabled(true);

    return this.room;
  }

  private setupEventListeners() {
    if (!this.room) return;

    this.room.on(RoomEvent.Connected, () => {
      console.log('✅ Connected to session');
    });

    this.room.on(RoomEvent.Disconnected, (reason) => {
      console.log('❌ Disconnected:', reason);
    });

    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.log('👤 Participant joined:', participant.identity);
    });

    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        // Attach agent's audio to play it
        const audioElement = track.attach();
        document.body.appendChild(audioElement);
      }
    });

    this.room.on(RoomEvent.DataReceived, (payload, participant) => {
      const decoder = new TextDecoder();
      const message = JSON.parse(decoder.decode(payload));

      // Handle message based on type
      this.handleMessage(message);
    });

    this.room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      console.log(`Connection quality: ${quality}`);
    });
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'transcript_chunk':
        this.onTranscript?.(message.data);
        break;
      case 'todo_list':
        this.onTodoList?.(message.data);
        break;
      case 'agent_status':
        this.onAgentStatus?.(message.data);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  async sendMessage(text: string) {
    if (!this.room) throw new Error('Not connected');

    const data = {
      type: 'user_text',
      data: text,
    };

    const encoder = new TextEncoder();
    await this.room.localParticipant.publishData(
      encoder.encode(JSON.stringify(data)),
      { reliable: true }
    );
  }

  async toggleMicrophone() {
    if (!this.room) return;

    const isEnabled = this.room.localParticipant.isMicrophoneEnabled;
    await this.room.localParticipant.setMicrophoneEnabled(!isEnabled);

    return !isEnabled;
  }

  disconnect() {
    if (this.room) {
      this.room.disconnect();
      this.room = null;
    }
  }

  // Event callbacks
  onTranscript?: (data: any) => void;
  onTodoList?: (data: any) => void;
  onAgentStatus?: (data: any) => void;
}

// Usage
const client = new SessionClient(sessionId, 'user-123', 'John Doe');

client.onTranscript = (data) => {
  console.log('Transcript:', data.text);
  // Update UI with transcript
};

client.onTodoList = (data) => {
  console.log('Todo list updated:', data.items);
  // Update UI with todo list
};

await client.connect();

// Send a message
await client.sendMessage('Hello, how are you?');

// Toggle microphone
await client.toggleMicrophone();

// Disconnect when done
client.disconnect();
```

## React Integration

### Custom Hook

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Room, RoomEvent } from 'livekit-client';

interface UseSessionOptions {
  sessionId: string;
  userId: string;
  userName: string;
  onTranscript?: (data: any) => void;
  onTodoList?: (data: any) => void;
}

export function useSession(options: UseSessionOptions) {
  const [room, setRoom] = useState<Room | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<string[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);

  // Connect to session
  useEffect(() => {
    let currentRoom: Room | null = null;

    async function connect() {
      // Get token
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

      // Create room
      currentRoom = new Room();

      // Event listeners
      currentRoom.on(RoomEvent.Connected, () => {
        setConnected(true);
      });

      currentRoom.on(RoomEvent.Disconnected, () => {
        setConnected(false);
      });

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
        }
      });

      // Connect
      await currentRoom.connect(serverUrl, token);

      // Enable microphone
      await currentRoom.localParticipant.setMicrophoneEnabled(true);
      setMicEnabled(true);

      setRoom(currentRoom);
    }

    connect();

    // Cleanup
    return () => {
      currentRoom?.disconnect();
    };
  }, [options.sessionId, options.userId, options.userName]);

  // Send message
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

  // Toggle microphone
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

  const { connected, participants, micEnabled, sendMessage, toggleMicrophone } =
    useSession({
      sessionId,
      userId: 'user-123',
      userName: 'John Doe',
      onTranscript: (data) => {
        setMessages((prev) => [...prev, data.text]);
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
      <div>Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}</div>
      <div>Participants: {participants.join(', ')}</div>

      <button onClick={toggleMicrophone}>
        {micEnabled ? '🎤 Mute' : '🔇 Unmute'}
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
// Add connection state debugging
room.on(RoomEvent.ConnectionStateChanged, (state) => {
  console.log('Connection state:', state);
  // States: connecting, connected, reconnecting, disconnected
});

// Monitor reconnection attempts
room.on(RoomEvent.Reconnecting, () => {
  console.log('Reconnecting to room...');
});

room.on(RoomEvent.Reconnected, () => {
  console.log('Reconnected successfully');
});
```

### Microphone Permission Denied

```typescript
async function requestMicrophonePermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Permission granted
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (error) {
    if (error.name === 'NotAllowedError') {
      alert('Microphone permission denied. Please enable it in browser settings.');
    }
    return false;
  }
}

// Request permission before connecting
const hasPermission = await requestMicrophonePermission();
if (hasPermission) {
  await client.connect();
}
```

### Audio Not Playing

```typescript
// Ensure audio elements are attached
room.on(RoomEvent.TrackSubscribed, (track) => {
  if (track.kind === Track.Kind.Audio) {
    const element = track.attach();

    // Some browsers require user interaction to play audio
    element.play().catch(error => {
      console.log('Autoplay prevented:', error);
      // Show a "Click to enable audio" button
    });

    document.body.appendChild(element);
  }
});
```

### Data Messages Not Received

```typescript
// Check if data track is published
room.on(RoomEvent.LocalTrackPublished, (publication) => {
  console.log('Published track:', publication.kind, publication.source);
});

// Ensure data messages use correct encoding
const sendData = async (data: any) => {
  const jsonString = JSON.stringify(data);
  const encoder = new TextEncoder();
  const bytes = encoder.encode(jsonString);

  console.log('Sending data:', bytes.length, 'bytes');

  await room.localParticipant.publishData(bytes, { reliable: true });
};
```

## Best Practices

1. **Always disconnect on unmount** to free resources
2. **Request microphone permission early** for better UX
3. **Use reliable: true for important messages** (transcripts, commands)
4. **Use reliable: false for real-time data** (volume levels, cursor position)
5. **Handle reconnection gracefully** with loading states
6. **Provide visual feedback** for connection status
7. **Implement error boundaries** for LiveKit errors

## Next Steps

- See [FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md) for API integration
- See [DASHBOARD_GUIDE.md](./DASHBOARD_GUIDE.md) for building UIs
- See [TYPESCRIPT_TYPES.md](./TYPESCRIPT_TYPES.md) for type definitions

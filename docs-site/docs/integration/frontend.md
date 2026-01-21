---
sidebar_position: 2
title: Frontend Integration
description: Integrating with the STELLA backend from your frontend
---

# Frontend Integration

This guide covers how to integrate your frontend application with the STELLA backend API and LiveKit for real-time communication.

## Overview

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Your Frontend  │────▶│  STELLA Backend  │────▶│  LiveKit Server  │
│     (React)      │     │   (REST + WS)    │     │    (WebRTC)      │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

## Installation

```bash
npm install @livekit/components-react livekit-client
```

## API Client Setup

### REST API Client

```typescript
// lib/api.ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

class StellaAPI {
  private baseUrl: string;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // Projects
  async getProjects() {
    return this.request<Project[]>('/api/projects');
  }

  async createProject(data: CreateProjectDto) {
    return this.request<Project>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Sessions
  async createSession(data: CreateSessionDto) {
    return this.request<Session>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getSession(sessionId: string) {
    return this.request<Session>(`/api/sessions/${sessionId}`);
  }

  async endSession(sessionId: string) {
    return this.request<void>(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  async joinSession(sessionId: string) {
    return this.request<JoinResponse>(`/api/sessions/${sessionId}/join`, {
      method: 'POST',
    });
  }

  async getSessionMessages(sessionId: string) {
    return this.request<Message[]>(`/api/sessions/${sessionId}/messages`);
  }
}

export const api = new StellaAPI();
```

### TypeScript Types

```typescript
// types/api.ts
export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  status: 'PENDING' | 'CONNECTING' | 'ACTIVE' | 'ENDING' | 'ENDED';
  agentType: string;
  roomName: string;
  createdAt: string;
}

export interface JoinResponse {
  token: string;
  url: string;
}

export interface Message {
  id: string;
  sessionId: string;
  speaker: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface CreateSessionDto {
  projectId: string;
  agentType: 'stella-agent' | 'stella-light' | 'echo-agent';
}
```

## LiveKit Integration

### Connection Component

```tsx
// components/VoiceChat.tsx
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useDataChannel,
} from '@livekit/components-react';
import { useState, useCallback, useEffect } from 'react';

interface VoiceChatProps {
  sessionId: string;
  onMessage?: (message: any) => void;
}

export function VoiceChat({ sessionId, onMessage }: VoiceChatProps) {
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function join() {
      try {
        const response = await api.joinSession(sessionId);
        setToken(response.token);
        setUrl(response.url);
      } catch (err) {
        setError(err.message);
      }
    }
    join();
  }, [sessionId]);

  if (error) {
    return <div className="error">Failed to join: {error}</div>;
  }

  if (!token || !url) {
    return <div className="loading">Connecting...</div>;
  }

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect={true}
      audio={true}
      video={false}
    >
      <RoomAudioRenderer />
      <ChatInterface onMessage={onMessage} />
    </LiveKitRoom>
  );
}
```

### Chat Interface

```tsx
// components/ChatInterface.tsx
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { useState, useCallback, useEffect } from 'react';

export function ChatInterface({ onMessage }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const [inputText, setInputText] = useState('');
  const { localParticipant } = useLocalParticipant();

  // Handle incoming data messages
  const handleDataReceived = useCallback((payload: Uint8Array) => {
    const message = JSON.parse(new TextDecoder().decode(payload));

    if (message.type === 'transcript') {
      if (message.data.isFinal) {
        setMessages(prev => [...prev, {
          speaker: message.data.speaker,
          text: message.data.text,
          timestamp: new Date(message.timestamp),
        }]);
      }
    } else if (message.type === 'status') {
      setStatus(message.data.status);
    }

    onMessage?.(message);
  }, [onMessage]);

  useDataChannel(handleDataReceived);

  // Send text message
  const sendTextMessage = useCallback(async (text: string) => {
    if (!localParticipant || !text.trim()) return;

    const message = {
      type: 'user_text',
      timestamp: Date.now(),
      data: text,
    };

    await localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(message)),
      { reliable: true }
    );

    setMessages(prev => [...prev, {
      speaker: 'user',
      text,
      timestamp: new Date(),
    }]);

    setInputText('');
  }, [localParticipant]);

  return (
    <div className="chat-interface">
      <div className="status-bar">
        <AgentStatus status={status} />
      </div>

      <div className="messages">
        {messages.map((msg, i) => (
          <MessageBubble key={i} message={msg} />
        ))}
      </div>

      <div className="input-area">
        <MicrophoneButton />
        <input
          type="text"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && sendTextMessage(inputText)}
          placeholder="Type a message..."
        />
        <button onClick={() => sendTextMessage(inputText)}>
          Send
        </button>
      </div>
    </div>
  );
}
```

### Microphone Control

```tsx
// components/MicrophoneButton.tsx
import { useLocalParticipant } from '@livekit/components-react';
import { useState } from 'react';

export function MicrophoneButton() {
  const { localParticipant } = useLocalParticipant();
  const [isMuted, setIsMuted] = useState(false);

  const toggleMute = async () => {
    if (!localParticipant) return;

    await localParticipant.setMicrophoneEnabled(isMuted);
    setIsMuted(!isMuted);
  };

  return (
    <button
      onClick={toggleMute}
      className={`mic-button ${isMuted ? 'muted' : 'active'}`}
      aria-label={isMuted ? 'Unmute' : 'Mute'}
    >
      {isMuted ? <MicOffIcon /> : <MicIcon />}
    </button>
  );
}
```

## WebSocket Updates

### Real-time Session Updates

```typescript
// hooks/useSessionUpdates.ts
import { useEffect, useCallback } from 'react';

export function useSessionUpdates(
  sessionId: string,
  onUpdate: (event: SessionEvent) => void
) {
  useEffect(() => {
    const ws = new WebSocket(
      `${WS_URL}/sessions/${sessionId}/ws`
    );

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onUpdate(data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, [sessionId, onUpdate]);
}
```

## Complete Example

### Session Page

```tsx
// pages/session/[id].tsx
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { VoiceChat } from '@/components/VoiceChat';
import { api } from '@/lib/api';

export default function SessionPage() {
  const router = useRouter();
  const { id } = router.query;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    async function loadSession() {
      try {
        const data = await api.getSession(id as string);
        setSession(data);
      } catch (err) {
        console.error('Failed to load session:', err);
      } finally {
        setLoading(false);
      }
    }

    loadSession();
  }, [id]);

  const handleEndSession = async () => {
    if (!session) return;

    await api.endSession(session.id);
    router.push('/');
  };

  if (loading) {
    return <div>Loading session...</div>;
  }

  if (!session) {
    return <div>Session not found</div>;
  }

  return (
    <div className="session-page">
      <header>
        <h1>Session: {session.id}</h1>
        <span className="status">{session.status}</span>
        <button onClick={handleEndSession}>End Session</button>
      </header>

      {session.status === 'ACTIVE' && (
        <VoiceChat sessionId={session.id} />
      )}

      {session.status === 'PENDING' && (
        <div className="connecting">
          <span>Connecting to agent...</span>
        </div>
      )}

      {session.status === 'ENDED' && (
        <div className="ended">
          <span>Session ended</span>
          <a href="/">Start new session</a>
        </div>
      )}
    </div>
  );
}
```

## Error Handling

```typescript
// lib/errors.ts
export class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

// Usage in API client
private async request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${this.baseUrl}${path}`, options);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new APIError(
      error.message || response.statusText,
      response.status,
      error.code
    );
  }

  return response.json();
}
```

## Next Steps

- [LiveKit Integration](/docs/integration/livekit) - LiveKit setup
- [Add Custom UI](/docs/guides/add-custom-ui) - UI customization
- [Architecture Overview](/docs/architecture/overview) - System architecture

---
sidebar_position: 4
title: React
description: React coding standards for the STELLA frontend
---

# React (Frontend)

Standards for the React frontend codebase.

## Style Guide

We follow the [React TypeScript Cheatsheet](https://react-typescript-cheatsheet.netlify.app/).

## Component Structure

```tsx
// Good: Functional component with TypeScript
interface MessageProps {
  text: string;
  speaker: 'user' | 'assistant';
  timestamp?: Date;
}

export function Message({ text, speaker, timestamp }: MessageProps) {
  return (
    <div className={`message message--${speaker}`}>
      <p>{text}</p>
      {timestamp && <time>{timestamp.toLocaleTimeString()}</time>}
    </div>
  );
}
```

## File Organization

```
components/
├── Message/
│   ├── Message.tsx         # Component
│   ├── Message.test.tsx    # Tests
│   └── index.ts            # Export
├── Chat/
│   ├── Chat.tsx
│   ├── ChatInput.tsx
│   ├── ChatMessages.tsx
│   └── index.ts
```

## Hooks

```tsx
// Custom hook with TypeScript
function useSession(sessionId: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function fetchSession() {
      try {
        const data = await api.getSession(sessionId);
        setSession(data);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, [sessionId]);

  return { session, loading, error };
}
```

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `ChatMessage` |
| Hooks | camelCase with `use` | `useSession` |
| Props interfaces | PascalCase + Props | `ChatMessageProps` |
| Event handlers | `handle` prefix | `handleClick` |
| Boolean props | `is`/`has` prefix | `isLoading`, `hasError` |
| Files | PascalCase | `ChatMessage.tsx` |

## Component Patterns

### Container/Presentational

```tsx
// Container: handles logic
function ChatContainer() {
  const { messages, sendMessage } = useChat();

  return <ChatView messages={messages} onSend={sendMessage} />;
}

// Presentational: handles display
function ChatView({ messages, onSend }: ChatViewProps) {
  return (
    <div className="chat">
      <MessageList messages={messages} />
      <MessageInput onSend={onSend} />
    </div>
  );
}
```

### Compound Components

```tsx
function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}

Card.Header = function CardHeader({ children }) {
  return <div className="card-header">{children}</div>;
};

Card.Body = function CardBody({ children }) {
  return <div className="card-body">{children}</div>;
};

// Usage
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
</Card>
```

## Best Practices

- Prefer functional components over class components
- Use TypeScript interfaces for all props
- Extract custom hooks for reusable logic
- Keep components small and focused
- Use React.memo() sparingly, only for expensive renders
- Avoid inline function definitions in JSX when possible

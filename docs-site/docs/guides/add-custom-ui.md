---
sidebar_position: 3
title: Add Custom UI
description: Customize the STELLA frontend for your application
---

import {Steps, Step} from '@site/src/components/StepGuide';

# Add Custom UI

The STELLA frontend is a React application that you can customize to match your brand and add application-specific features. This guide covers theming, component customization, and adding new functionality.

## Frontend Architecture

The STELLA frontend is built with:
- **React 18** with TypeScript
- **Tailwind CSS** for styling
- **LiveKit React SDK** for real-time communication
- **Zustand** for state management

```
frontend-ui/
├── src/
│   ├── components/        # Reusable UI components
│   ├── pages/             # Route pages
│   ├── hooks/             # Custom React hooks
│   ├── stores/            # Zustand stores
│   ├── lib/               # Utilities and API clients
│   └── styles/            # Global styles
├── public/
└── tailwind.config.js
```

## Theming

### Customize Colors

STELLA uses a purple-based color palette. Modify `tailwind.config.js` to change the theme:

```js title="tailwind.config.js"
module.exports = {
  theme: {
    extend: {
      colors: {
        // Primary brand color
        primary: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',  // Main brand color
          600: '#9333ea',
          700: '#7c3aed',
          800: '#6b21a8',
          900: '#581c87',
        },
        // Surface colors (warm tones)
        surface: {
          DEFAULT: '#f8f7f4',
          secondary: '#f3f2ef',
          tertiary: '#eceae6',
          dark: '#18181b',
          'dark-secondary': '#27272a',
        },
      },
    },
  },
};
```

### Dark Mode

STELLA supports automatic dark mode. Toggle it in your components:

```tsx
import { useTheme } from '@/hooks/useTheme';

function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
```

## Customizing the Chat Interface

### Message Bubbles

Customize how messages are displayed:

```tsx title="src/components/MessageBubble.tsx"
interface MessageBubbleProps {
  message: Message;
  isUser: boolean;
}

export function MessageBubble({ message, isUser }: MessageBubbleProps) {
  return (
    <div className={`
      flex ${isUser ? 'justify-end' : 'justify-start'}
      mb-4
    `}>
      <div className={`
        max-w-[80%] rounded-2xl px-4 py-3
        ${isUser
          ? 'bg-primary-500 text-white rounded-br-md'
          : 'bg-surface-secondary text-gray-900 rounded-bl-md'
        }
      `}>
        {message.content}
      </div>
    </div>
  );
}
```

### Voice Visualization

Add a custom audio visualizer:

```tsx title="src/components/AudioVisualizer.tsx"
import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  audioTrack: MediaStreamTrack | null;
}

export function AudioVisualizer({ audioTrack }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!audioTrack || !canvasRef.current) return;

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(
      new MediaStream([audioTrack])
    );

    source.connect(analyser);
    analyser.fftSize = 256;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;

    function draw() {
      requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.fillStyle = 'rgb(24, 24, 27)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i] / 2;

        ctx.fillStyle = `rgb(168, 85, ${247 - barHeight})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

        x += barWidth + 1;
      }
    }

    draw();

    return () => {
      audioContext.close();
    };
  }, [audioTrack]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-16 rounded-lg"
      width={300}
      height={64}
    />
  );
}
```

## Adding New Pages

<Steps>

<Step number={1} title="Create the page component">

```tsx title="src/pages/SettingsPage.tsx"
import { PageLayout } from '@/components/PageLayout';

export function SettingsPage() {
  return (
    <PageLayout title="Settings">
      <div className="space-y-6">
        <section>
          <h2 className="text-lg font-semibold mb-4">Audio Settings</h2>
          {/* Audio settings content */}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-4">Appearance</h2>
          {/* Theme settings content */}
        </section>
      </div>
    </PageLayout>
  );
}
```

</Step>

<Step number={2} title="Add the route">

```tsx title="src/App.tsx"
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SettingsPage } from '@/pages/SettingsPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

</Step>

<Step number={3} title="Add navigation" isLast>

```tsx title="src/components/Navigation.tsx"
import { Link } from 'react-router-dom';

export function Navigation() {
  return (
    <nav className="flex items-center gap-4">
      <Link to="/" className="hover:text-primary-500">Home</Link>
      <Link to="/settings" className="hover:text-primary-500">Settings</Link>
    </nav>
  );
}
```

</Step>

</Steps>

## Integrating with LiveKit

### Custom Room Controls

```tsx title="src/components/RoomControls.tsx"
import { useLocalParticipant } from '@livekit/components-react';

export function RoomControls() {
  const { localParticipant } = useLocalParticipant();
  const [isMuted, setIsMuted] = useState(false);

  const toggleMute = async () => {
    await localParticipant.setMicrophoneEnabled(!isMuted);
    setIsMuted(!isMuted);
  };

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={toggleMute}
        className={`
          p-3 rounded-full transition-colors
          ${isMuted
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-primary-500 hover:bg-primary-600'
          }
        `}
      >
        {isMuted ? <MicOffIcon /> : <MicIcon />}
      </button>
    </div>
  );
}
```

### Handling Agent Status

```tsx title="src/components/AgentStatus.tsx"
import { useAgentStatus } from '@/hooks/useAgentStatus';

export function AgentStatus() {
  const { status, message } = useAgentStatus();

  const statusConfig = {
    listening: { label: 'Listening', color: 'bg-green-500' },
    thinking: { label: 'Thinking', color: 'bg-yellow-500' },
    speaking: { label: 'Speaking', color: 'bg-primary-500' },
    idle: { label: 'Ready', color: 'bg-gray-400' },
  };

  const config = statusConfig[status] || statusConfig.idle;

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${config.color} animate-pulse`} />
      <span className="text-sm text-gray-600">{config.label}</span>
      {message && (
        <span className="text-xs text-gray-400">- {message}</span>
      )}
    </div>
  );
}
```

## Building for Production

```bash
# Install dependencies
npm install

# Build for production
npm run build

# The output will be in the dist/ folder
```

### Environment Variables

```bash title=".env.production"
VITE_API_URL=https://api.yourdomain.com
VITE_LIVEKIT_URL=wss://livekit.yourdomain.com
```

## Next Steps

- [Frontend Integration](/docs/integration/frontend) - API integration details
- [LiveKit Integration](/docs/integration/livekit) - Real-time communication setup
- [Architecture Overview](/docs/architecture/overview) - System architecture

# Realtime Voice WebRTC UI

React plus Vite plus TypeScript plus Tailwind. Streams mic audio to a peer and receives TTS audio back. Shows a live transcript with text input backup.

## Quick start

1. Clone and install
```bash
npm i
```

2. Configure LiveKit connection in .env.local
```bash
echo 'VITE_LIVEKIT_URL=ws://localhost:7880' > .env.local
echo 'VITE_LIVEKIT_API_KEY=devkey' >> .env.local
echo 'VITE_LIVEKIT_API_SECRET=secret' >> .env.local
```

3. Run
```bash
npm run dev
```

This application connects to a LiveKit server for real-time voice and text communication.
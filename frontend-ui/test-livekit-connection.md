# LiveKit Connection Test Instructions

## 1. Start LiveKit Server

```bash
cd livekit-server
docker-compose up
```

Verify server is running:
- Check logs for "server started"
- Port 7880 should be listening for WebSocket connections
- Port 7881 should be listening for UDP media

## 2. Start Frontend

```bash
cd realtime-voice-webrtc-ui
npm run dev
```

## 3. Test Connection

1. Open browser to `http://localhost:5173` (or the port shown by Vite)
2. Open browser DevTools (F12) and go to Console tab
3. Click the "Connect" button
4. Monitor console for:
   - "Connected to LiveKit room"
   - "Published microphone track"
   - Any connection errors

## 4. Expected Behavior

**Successful Connection:**
- Status shows "connected"
- Console logs: "Connected to LiveKit room"
- LiveKit server logs show new participant joined
- Microphone permission granted
- VU meter shows audio activity

**Common Issues:**
- CORS errors: Check LiveKit server CORS settings
- WebSocket connection failed: Verify server URL and port
- Microphone access denied: Grant microphone permission
- Token errors: Check API key/secret configuration

## 5. Verify from LiveKit Server Side

Check Docker logs:
```bash
docker-compose logs -f livekit
```

Look for:
- New participant connected
- Audio track published
- Data channel messages

## 6. Test Audio Flow

- Speak into microphone (should see VU meter activity)
- Type messages in chat (should be sent via data channel)
- Check server logs for received messages

## Environment Variables

Current configuration in `.env.local`:
- `VITE_LIVEKIT_URL=ws://localhost:7880`
- `VITE_LIVEKIT_API_KEY=devkey`
- `VITE_LIVEKIT_API_SECRET=secret`

These must match your LiveKit server configuration in `livekit-server/.env`.
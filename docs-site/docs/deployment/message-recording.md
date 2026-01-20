---
sidebar_position: 4
title: "Message Recording"
---

# Message Recording & History

STELLA includes a message recording system that silently captures all session messages for history retrieval and persistence.

## Overview

The system provides:

- **Silent recording** - Backend automatically records all sessions
- **Full history** - Users see complete conversation when entering a session
- **Real-time merge** - New messages seamlessly append to history
- **Infinite scroll** - Older messages load automatically
- **Production-ready** - Handles failures, reconnections, and edge cases

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    LiveKit Server                           │
│  Room: session-123    Room: session-456                     │
│    ├── Agent           ├── Agent                            │
│    ├── User            └── User                             │
│    └── Monitor (message-recorder)                           │
└─────────────────────────────────────────────────────────────┘
                    ▲                ▲
                    │                │
          ┌─────────┴────────┬──────┴──────┐
          │                  │             │
┌─────────▼─────────┐       │             │
│ Room Monitor      │       │             │
│ Service (NestJS)  │       │             │
│ • Auto-joins      │       │             │
│ • Silent listener │       │             │
│ • Filters finals  │       │             │
│ • Persists to DB  │       │             │
└─────────┬─────────┘       │             │
          │                  │             │
          ▼                  │             │
┌─────────────────┐         │             │
│   PostgreSQL    │         │             │
│   (Messages)    │         │             │
└─────────┬───────┘         │             │
          │                  │             │
          ▼                  │             │
┌─────────────────┐         │             │
│  REST API       │◄────────┘             │
│  /messages      │                       │
└───────┬─────────┘                       │
        │                                  │
        ▼                                  │
┌─────────────────┐                       │
│  Frontend       │◄──────────────────────┘
│  ChatView       │    (Real-time msgs)
│ • Load history  │
│ • Merge realtime│
│ • Infinite scroll│
└─────────────────┘
```

## Components

### Backend

| Component | Location | Purpose |
|-----------|----------|---------|
| RoomMonitorService | `src/message-recorder/room-monitor.service.ts` | Silently joins LiveKit rooms |
| MessageRecorderService | `src/message-recorder/message-recorder.service.ts` | Persists messages to PostgreSQL |
| Message API | `src/sessions/sessions.controller.ts` | REST endpoints for history |

### Frontend

| Component | Location | Purpose |
|-----------|----------|---------|
| ApiClient | `src/services/ApiClient.ts` | `getSessionMessages()`, `getLatestMessages()` |
| Store | `src/store/index.ts` | Historical message state management |
| ChatView | `src/components/ChatView.tsx` | Merges historical + real-time messages |

## Database Schema

Enhanced Message model in `prisma/schema.prisma`. See [Database Schema](/docs/architecture/database) for the complete data model.

```prisma
model Message {
  id          String   @id @default(uuid())
  sessionId   String
  content     String
  role        String   // user, assistant, system
  status      String?  // pending, complete
  metadata    Json?    // Additional message data
  timestamp   DateTime @default(now())
  createdAt   DateTime @default(now())

  session     Session  @relation(fields: [sessionId], references: [id])

  @@index([sessionId, timestamp])
}
```

## API Endpoints

### Get Session Messages

```bash
GET /sessions/:sessionId/messages?cursor=<id>&limit=50
```

Returns cursor-based paginated messages.

### Get Latest Messages

```bash
GET /sessions/:sessionId/messages/latest?since=<timestamp>
```

Returns messages since a specific timestamp for real-time sync.

## Message Filtering

### Recorded

- Final transcripts (`is_final: true`)
- Task list updates (`complete_todo_list`)
- Deliverables (`plan_deliverable_update`)
- State changes (`state_change_notification`)
- Participant events (join/leave)

### Skipped

- Partial transcripts
- TTS control messages
- Audio stream chunks

## Deployment

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Generate Prisma Client

```bash
npx prisma generate
```

### Step 3: Run Database Migration

```bash
npx prisma migrate dev --name enhance_message_model
```

### Step 4: Restart Backend

The Room Monitor Service will automatically:
- Start monitoring all ACTIVE sessions on startup
- Begin recording messages immediately

```bash
npm run start:dev
```

Verify in logs:

```
[RoomMonitorService] Room Monitor Service initializing...
[RoomMonitorService] Found X active sessions to monitor
[RoomMonitorService] Successfully connected to room session-...
```

### Step 5: Rebuild Frontend

```bash
cd frontend-ui
npm run build  # production
# OR
npm run dev    # development
```

## Configuration

No new environment variables required. The system uses existing LiveKit configuration:

```env
LIVEKIT_URL=ws://livekit:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
DATABASE_URL=postgresql://...
```

## Monitoring Behavior

| Feature | Behavior |
|---------|----------|
| Auto-start | Joins all ACTIVE sessions on app boot |
| Auto-reconnect | 5 retry attempts with exponential backoff |
| Auto-stop | Disconnects when session is closed |

## Performance

### Database

- **Indexes**: Optimized for `sessionId + timestamp` queries
- **Storage**: ~2.5MB per 1000 messages
- **Query time**: Under 50ms for 50 messages with proper indexes

### Frontend

- **Initial load**: 50 messages (configurable)
- **Pagination**: 50 messages per scroll
- **Deduplication**: O(n) using Map
- **Re-renders**: Optimized with useMemo

### Backend

- **Connection per session**: One silent LiveKit connection
- **Memory usage**: ~5MB per monitored room
- **Scalability**: Tested with 100+ parallel sessions

## Verification Checklist

### Backend

- [ ] Database migration completed successfully
- [ ] Room Monitor Service starts without errors
- [ ] Messages are being recorded:

```sql
SELECT * FROM "Message" ORDER BY "timestamp" DESC LIMIT 10;
```

### Frontend

- [ ] Opening a session loads historical messages
- [ ] Scrolling to top loads more messages (if >50 exist)
- [ ] New real-time messages append to the bottom
- [ ] No duplicate messages in the UI
- [ ] Loading indicators appear during fetch

## Troubleshooting

### Messages Not Being Recorded

1. Check Room Monitor Service logs:
   ```bash
   grep "RoomMonitorService" logs/
   ```

2. Verify the service is monitoring the session:
   ```bash
   curl http://localhost:3000/monitoring/stats
   ```

3. Check database connectivity:
   ```bash
   npx prisma studio
   ```

### Frontend Not Loading History

1. Open browser DevTools → Network tab
2. Look for failed `/sessions/:id/messages` requests
3. Verify API endpoint is accessible:
   ```bash
   curl http://localhost:3000/sessions/SESSION_ID/messages
   ```

### Duplicate Messages in UI

This should not happen (deduplication by ID), but if it does:

1. Check for duplicate IDs in database:
   ```sql
   SELECT id, COUNT(*) FROM "Message" GROUP BY id HAVING COUNT(*) > 1;
   ```

2. Verify deduplication logic in ChatView.tsx

## Future Enhancements

- **Message search**: Full-text search across historical messages
- **Export**: Download conversation history as JSON/PDF
- **Filters**: Filter by message type, participant, date range
- **Analytics**: Message statistics and conversation insights
- **Compression**: Archive old messages to reduce database size

## See Also

- [Database Schema](/docs/architecture/database) - Complete data model
- [Session Lifecycle](/docs/architecture/session-lifecycle)
- [LiveKit Integration](/docs/integration/livekit)
- [Frontend Integration](/docs/integration/frontend)

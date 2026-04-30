# Pod Creation Timeout During Log Streaming

**Date observed:** 2026-04-01
**Severity:** high
**Status:** open
**Related code:** `src/agents/agents.service.ts:519-560`

## What Happened

When a client requests log streaming before the Kubernetes pod is fully created, the system polls the database for a `podName` with a 60-second timeout (2-second intervals). If pod creation takes longer than 60 seconds, the log stream request fails even though the pod may start successfully shortly after.

## Steps to Reproduce

1. Start an agent session that uses a large container image (or simulate slow image pull)
2. Immediately request log streaming via the SSE endpoint before the pod is running
3. Wait for ~60 seconds

## Relevant Configuration

The timeout is hardcoded in the log streaming logic:

```typescript
// agents.service.ts — streamLogs()
// Polls for podName every 2 seconds, times out after 60 seconds
```

## Expected Behavior

The log stream should wait for the pod to become available and begin streaming once ready, or provide a clear retry mechanism.

## Actual Behavior

Client receives a `Timeout waiting for pod creation after 60s` error. The pod may start successfully at 65+ seconds, but the stream has already terminated.

## Root Cause (if known)

The 60-second hard limit does not account for variable pod startup times that depend on image pull duration, scheduler load, and node availability. The timeout is not configurable.

## Workaround (if any)

Retry the log stream request after receiving the timeout error. The pod will likely be running by then.

## Notes

Consider making the timeout configurable or implementing an exponential backoff with a longer overall deadline. Could also notify the client that the pod is still starting rather than failing outright.

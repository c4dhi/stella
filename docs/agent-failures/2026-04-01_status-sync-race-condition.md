# Status Sync Race Condition: STARTING to STOPPED

**Date observed:** 2026-04-01
**Severity:** critical
**Status:** open
**Related code:** `src/agents/agents.service.ts:155-225`, `src/agents/agents.service.ts:809-821`

## What Happened

After calling `restartAgent()`, the agent status is set to STARTING and the `podName` is cleared from the database. If `syncAgentStatus()` runs concurrently before the new pod is created, it reads the cleared `podName`, finds no matching pod in Kubernetes, and overwrites the status from STARTING to STOPPED.

## Steps to Reproduce

1. Have a running agent (status: RUNNING)
2. Trigger a restart via `restartAgent()`
3. Observe that `syncAgentStatus()` fires during the window between pod cleanup and new pod creation
4. Agent status transitions: RUNNING -> STARTING -> STOPPED (stuck)

## Relevant Configuration

No special configuration needed — this is a timing-dependent race condition that occurs under normal operation, especially on clusters with slower pod scheduling.

## Expected Behavior

Agent transitions: RUNNING -> STARTING -> RUNNING. The restart completes and the agent reconnects via gRPC.

## Actual Behavior

Agent gets stuck in STOPPED state. The gRPC registration check uses status to determine if a connection is allowed, so the agent never reconnects. Manual intervention is required to restart the agent.

## Root Cause (if known)

No locking or version checks prevent concurrent status updates. The sync function has a guard to avoid overwriting STARTING status, but this is bypassed when `podName` is null at query time — the sync logic treats a missing pod as definitive evidence that the agent is stopped.

## Workaround (if any)

Manually restart the agent again after observing the stuck STOPPED state.

## Notes

Possible fixes:
- Add a `statusUpdatedAt` timestamp and skip sync updates if the status was recently changed
- Use optimistic locking (version field) on agent status updates
- Extend the STARTING grace period in `syncAgentStatus()` to also check for null `podName` scenarios

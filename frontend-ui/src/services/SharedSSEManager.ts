/**
 * SharedSSEManager - Manages SSE connections across browser tabs using BroadcastChannel
 *
 * Problem: HTTP/1.1 has a 6-connection-per-origin limit. With multiple SSE connections
 * per tab (project events, project metrics, notifications), opening 2+ tabs can exhaust
 * this limit, causing HTTP requests to queue and hang.
 *
 * Solution: Use BroadcastChannel to elect a "leader" tab that owns the actual SSE
 * connections and broadcasts events to other tabs. This reduces N connections to 1.
 *
 * Usage:
 *   const manager = getSharedSSEManager('project-metrics', projectId)
 *   manager.subscribe(callback)
 *   // ... later
 *   manager.unsubscribe(callback)
 */

import { apiClient } from './ApiClient'
import type { ProjectMetrics, ProjectSessionEvent } from '../lib/api-types'

type SSEType = 'project-metrics' | 'project-events'
type SSEData = ProjectMetrics | ProjectSessionEvent

interface Subscriber {
  callback: (data: SSEData) => void
  onError?: (error: Event) => void
  onOpen?: () => void
}

interface ChannelMessage {
  type: 'LEADER_PING' | 'LEADER_PONG' | 'SSE_DATA' | 'SSE_ERROR' | 'SSE_OPEN' | 'LEADER_LEAVING'
  sseType: SSEType
  resourceId: string
  senderId: string
  data?: SSEData
}

// Generate unique tab ID
const TAB_ID = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`

// Global state for managing shared connections
const channels = new Map<string, BroadcastChannel>()
const subscribers = new Map<string, Set<Subscriber>>()
const sseCleanups = new Map<string, () => void>()
const isLeader = new Map<string, boolean>()
const leaderTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function getChannelKey(sseType: SSEType, resourceId: string): string {
  return `${sseType}:${resourceId}`
}

function getOrCreateChannel(key: string): BroadcastChannel {
  if (!channels.has(key)) {
    const channel = new BroadcastChannel(`stella-sse-${key}`)
    channels.set(key, channel)

    channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
      handleChannelMessage(event.data)
    }
  }
  return channels.get(key)!
}

function handleChannelMessage(msg: ChannelMessage): void {
  const key = getChannelKey(msg.sseType, msg.resourceId)
  const subs = subscribers.get(key)

  switch (msg.type) {
    case 'LEADER_PING':
      // Another tab is checking for a leader - respond if we're the leader
      if (isLeader.get(key) && sseCleanups.has(key)) {
        const channel = channels.get(key)
        channel?.postMessage({
          type: 'LEADER_PONG',
          sseType: msg.sseType,
          resourceId: msg.resourceId,
          senderId: TAB_ID,
        } as ChannelMessage)
      }
      break

    case 'LEADER_PONG':
      // A leader exists, cancel our leadership attempt
      const timeout = leaderTimeouts.get(key)
      if (timeout) {
        clearTimeout(timeout)
        leaderTimeouts.delete(key)
      }
      isLeader.set(key, false)
      // Notify subscribers we're connected (via the leader)
      subs?.forEach((sub) => sub.onOpen?.())
      break

    case 'SSE_DATA':
      // Leader is forwarding SSE data
      if (!isLeader.get(key) && msg.data) {
        subs?.forEach((sub) => sub.callback(msg.data!))
      }
      break

    case 'SSE_ERROR':
      // Leader experienced an error
      if (!isLeader.get(key)) {
        subs?.forEach((sub) => sub.onError?.(new Event('SSE Error')))
      }
      break

    case 'SSE_OPEN':
      // Leader's SSE connection opened
      if (!isLeader.get(key)) {
        subs?.forEach((sub) => sub.onOpen?.())
      }
      break

    case 'LEADER_LEAVING':
      // Leader is disconnecting, try to become the new leader
      if (!isLeader.get(key) && subs && subs.size > 0) {
        attemptLeadership(msg.sseType, msg.resourceId)
      }
      break
  }
}

function becomeLeader(sseType: SSEType, resourceId: string): void {
  const key = getChannelKey(sseType, resourceId)

  if (isLeader.get(key) || sseCleanups.has(key)) {
    return
  }

  isLeader.set(key, true)
  console.log(`[SharedSSEManager] Becoming leader for ${key}`)

  const channel = channels.get(key)
  const subs = subscribers.get(key)

  // Create the actual SSE connection based on type
  let cleanup: () => void

  if (sseType === 'project-metrics') {
    cleanup = apiClient.subscribeToProjectMetrics(
      resourceId,
      (data) => {
        // Handle locally
        subs?.forEach((sub) => sub.callback(data))
        // Broadcast to other tabs
        channel?.postMessage({
          type: 'SSE_DATA',
          sseType,
          resourceId,
          senderId: TAB_ID,
          data,
        } as ChannelMessage)
      },
      (error) => {
        subs?.forEach((sub) => sub.onError?.(error))
        channel?.postMessage({
          type: 'SSE_ERROR',
          sseType,
          resourceId,
          senderId: TAB_ID,
        } as ChannelMessage)
      },
      () => {
        subs?.forEach((sub) => sub.onOpen?.())
        channel?.postMessage({
          type: 'SSE_OPEN',
          sseType,
          resourceId,
          senderId: TAB_ID,
        } as ChannelMessage)
      }
    )
  } else {
    // project-events
    cleanup = apiClient.subscribeToProjectEvents(
      resourceId,
      (data) => {
        subs?.forEach((sub) => sub.callback(data))
        channel?.postMessage({
          type: 'SSE_DATA',
          sseType,
          resourceId,
          senderId: TAB_ID,
          data,
        } as ChannelMessage)
      },
      (error) => {
        subs?.forEach((sub) => sub.onError?.(error))
        channel?.postMessage({
          type: 'SSE_ERROR',
          sseType,
          resourceId,
          senderId: TAB_ID,
        } as ChannelMessage)
      },
      () => {
        subs?.forEach((sub) => sub.onOpen?.())
        channel?.postMessage({
          type: 'SSE_OPEN',
          sseType,
          resourceId,
          senderId: TAB_ID,
        } as ChannelMessage)
      }
    )
  }

  sseCleanups.set(key, cleanup)
}

function attemptLeadership(sseType: SSEType, resourceId: string): void {
  const key = getChannelKey(sseType, resourceId)

  // Already a leader or attempting
  if (isLeader.get(key) || leaderTimeouts.has(key)) {
    return
  }

  const channel = getOrCreateChannel(key)

  // Ping to check for existing leader
  channel.postMessage({
    type: 'LEADER_PING',
    sseType,
    resourceId,
    senderId: TAB_ID,
  } as ChannelMessage)

  // Wait for response, become leader if no response
  const timeout = setTimeout(() => {
    leaderTimeouts.delete(key)
    becomeLeader(sseType, resourceId)
  }, 200)

  leaderTimeouts.set(key, timeout)
}

export interface SharedSSEHandle {
  subscribe: (
    callback: (data: SSEData) => void,
    onError?: (error: Event) => void,
    onOpen?: () => void
  ) => void
  unsubscribe: (callback: (data: SSEData) => void) => void
}

/**
 * Get a shared SSE manager for a specific type and resource.
 * Multiple calls with the same parameters will share the same underlying connection.
 */
export function getSharedSSEManager(sseType: SSEType, resourceId: string): SharedSSEHandle {
  const key = getChannelKey(sseType, resourceId)

  return {
    subscribe: (callback, onError, onOpen) => {
      // Initialize subscriber set if needed
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set())
      }

      const subs = subscribers.get(key)!
      const subscriber: Subscriber = { callback, onError, onOpen }
      subs.add(subscriber)

      // Initialize channel and attempt leadership
      getOrCreateChannel(key)
      attemptLeadership(sseType, resourceId)
    },

    unsubscribe: (callback) => {
      const subs = subscribers.get(key)
      if (!subs) return

      // Find and remove the subscriber with this callback
      for (const sub of subs) {
        if (sub.callback === callback) {
          subs.delete(sub)
          break
        }
      }

      // If no more subscribers, clean up
      if (subs.size === 0) {
        subscribers.delete(key)

        // If we're the leader, notify others and clean up SSE
        if (isLeader.get(key)) {
          const channel = channels.get(key)
          channel?.postMessage({
            type: 'LEADER_LEAVING',
            sseType,
            resourceId,
            senderId: TAB_ID,
          } as ChannelMessage)

          const cleanup = sseCleanups.get(key)
          cleanup?.()
          sseCleanups.delete(key)
        }

        // Clean up channel
        const channel = channels.get(key)
        channel?.close()
        channels.delete(key)
        isLeader.delete(key)

        const timeout = leaderTimeouts.get(key)
        if (timeout) {
          clearTimeout(timeout)
          leaderTimeouts.delete(key)
        }
      }
    },
  }
}

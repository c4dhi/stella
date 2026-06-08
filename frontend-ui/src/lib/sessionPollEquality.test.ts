import { describe, it, expect } from 'vitest'
import { areAgentListsEqual, isSameListenerStatus } from './sessionPollEquality'
import { AgentStatus, SessionStatus, type AgentInstance, type ListenerStatus } from './api-types'

function makeAgent(overrides: Partial<AgentInstance> = {}): AgentInstance {
  return {
    id: 'agent-1',
    sessionId: 'session-1',
    name: 'Stella',
    icon: null,
    status: AgentStatus.RUNNING,
    podName: 'pod-1',
    secretName: null,
    configMapName: null,
    agentConfig: { model: 'gpt-4' },
    createdAt: '2026-01-01T00:00:00.000Z',
    stoppedAt: null,
    ...overrides,
  }
}

function makeListenerStatus(overrides: Partial<ListenerStatus['listener']> = {}): ListenerStatus {
  return {
    sessionId: 'session-1',
    sessionStatus: SessionStatus.ACTIVE,
    listener: {
      isMonitoring: true,
      isConnected: true,
      roomState: 'connected',
      participantIdentity: 'listener-1',
      reconnectAttempts: 0,
      remoteParticipants: 2,
      ...overrides,
    },
  }
}

describe('areAgentListsEqual', () => {
  it('returns true for the same reference', () => {
    const list = [makeAgent()]
    expect(areAgentListsEqual(list, list)).toBe(true)
  })

  it('returns true for structurally equal but distinct arrays', () => {
    expect(areAgentListsEqual([makeAgent()], [makeAgent()])).toBe(true)
  })

  it('returns false when length differs', () => {
    expect(areAgentListsEqual([makeAgent()], [makeAgent(), makeAgent({ id: 'agent-2' })])).toBe(false)
  })

  it.each([
    ['status', { status: AgentStatus.STOPPED }],
    ['podName', { podName: 'pod-2' }],
    ['name', { name: 'Renamed' }],
    ['icon', { icon: '🤖' }],
    ['stoppedAt', { stoppedAt: '2026-01-02T00:00:00.000Z' }],
  ] as const)('returns false when %s changes', (_field, override) => {
    expect(areAgentListsEqual([makeAgent()], [makeAgent(override)])).toBe(false)
  })

  it('detects an in-place agentConfig change (no status/podName change)', () => {
    expect(
      areAgentListsEqual([makeAgent()], [makeAgent({ agentConfig: { model: 'gpt-4o' } })]),
    ).toBe(false)
  })

  it('treats equal agentConfig objects as unchanged', () => {
    expect(
      areAgentListsEqual(
        [makeAgent({ agentConfig: { a: 1, b: 2 } })],
        [makeAgent({ agentConfig: { a: 1, b: 2 } })],
      ),
    ).toBe(true)
  })

  it('handles two empty lists', () => {
    expect(areAgentListsEqual([], [])).toBe(true)
  })
})

describe('isSameListenerStatus', () => {
  it('returns false when the previous value is null (first poll)', () => {
    expect(isSameListenerStatus(null, makeListenerStatus())).toBe(false)
  })

  it('returns true for structurally equal statuses', () => {
    expect(isSameListenerStatus(makeListenerStatus(), makeListenerStatus())).toBe(true)
  })

  it.each([
    ['isMonitoring', { isMonitoring: false }],
    ['isConnected', { isConnected: false }],
    ['roomState', { roomState: 'reconnecting' }],
    ['participantIdentity', { participantIdentity: 'listener-2' }],
    ['reconnectAttempts', { reconnectAttempts: 3 }],
    ['remoteParticipants', { remoteParticipants: 5 }],
  ] as const)('returns false when listener.%s changes', (_field, override) => {
    expect(isSameListenerStatus(makeListenerStatus(), makeListenerStatus(override))).toBe(false)
  })

  it('returns false when sessionStatus changes', () => {
    const prev = makeListenerStatus()
    const next: ListenerStatus = { ...makeListenerStatus(), sessionStatus: SessionStatus.CLOSED }
    expect(isSameListenerStatus(prev, next)).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { pickDefaultSink } from './mediaDevices'

// Minimal MediaDeviceInfo-shaped stub — pickDefaultSink only reads deviceId.
const dev = (deviceId: string): MediaDeviceInfo =>
  ({ deviceId, kind: 'audiooutput', label: '', groupId: '' } as MediaDeviceInfo)

describe('pickDefaultSink', () => {
  it('returns empty string for an empty list (system default)', () => {
    expect(pickDefaultSink([])).toBe('')
  })

  it('prefers the entry the browser labels as "default"', () => {
    const devices = [dev('abc'), dev('default'), dev('xyz')]
    expect(pickDefaultSink(devices)).toBe('default')
  })

  it('falls back to the first device when there is no explicit default', () => {
    const devices = [dev('abc'), dev('xyz')]
    expect(pickDefaultSink(devices)).toBe('abc')
  })
})

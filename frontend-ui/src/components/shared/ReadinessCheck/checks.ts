import { Room, createLocalAudioTrack, ConnectionState } from 'livekit-client'
import { CheckResult } from './types'
import { getRuntimeConfig } from '../../../config/runtime'
import { apiClient } from '../../../services/ApiClient'
import type { MediaTestSession } from '../../../lib/api-types'
import {
  checkMicrophonePermission,
  requestMicrophoneAccess,
} from '../../../lib/mediaDevices'

export async function runBrowserCheck(): Promise<CheckResult> {
  const ua = navigator.userAgent
  const matchers: Array<{ name: string; re: RegExp; min: number }> = [
    { name: 'Edge', re: /Edg\/(\d+)/, min: 110 },
    { name: 'Chrome', re: /Chrome\/(\d+)/, min: 110 },
    { name: 'Firefox', re: /Firefox\/(\d+)/, min: 115 },
    { name: 'Safari', re: /Version\/(\d+).*Safari/, min: 16 },
  ]
  for (const m of matchers) {
    const found = ua.match(m.re)
    if (found) {
      const v = parseInt(found[1], 10)
      if (v >= m.min) return { id: 'browser', status: 'pass', detail: `${m.name} ${v}` }
      return {
        id: 'browser',
        status: 'warn',
        detail: `${m.name} ${v} — ${m.min}+ recommended`,
      }
    }
  }
  return { id: 'browser', status: 'warn', detail: 'Unrecognised browser' }
}

export async function runMicPermissionCheck(): Promise<{
  result: CheckResult
  stream: MediaStream | null
}> {
  const state = await checkMicrophonePermission()
  if (state === 'denied') {
    return {
      result: {
        id: 'micPermission',
        status: 'fail',
        detail: 'Microphone access was blocked. Allow it in your browser settings.',
      },
      stream: null,
    }
  }
  const stream = await requestMicrophoneAccess()
  if (!stream) {
    return {
      result: {
        id: 'micPermission',
        status: 'fail',
        detail: 'Microphone access denied or unavailable.',
      },
      stream: null,
    }
  }
  return {
    result: { id: 'micPermission', status: 'pass', detail: 'Microphone access granted' },
    stream,
  }
}

export async function runMicLevelCheck(stream: MediaStream): Promise<CheckResult> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
  const source = ctx.createMediaStreamSource(stream)
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const buf = new Uint8Array(analyser.frequencyBinCount)
  const start = Date.now()
  let peak = 0
  return new Promise((resolve) => {
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let max = 0
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i] - 128)
        if (v > max) max = v
      }
      peak = Math.max(peak, max)
      const elapsed = Date.now() - start
      if (peak >= 8 || elapsed > 5000) {
        ctx.close().catch(() => {})
        if (peak >= 8) {
          resolve({ id: 'micLevel', status: 'pass', metric: peak, detail: 'Audio detected' })
        } else {
          resolve({
            id: 'micLevel',
            status: 'warn',
            metric: peak,
            detail: 'No audio detected — check that you are not muted',
          })
        }
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  })
}

export async function runNetworkCheck(): Promise<CheckResult> {
  const cfg = getRuntimeConfig()
  const url = `${cfg.apiUrl}/health/public`
  const samples: number[] = []
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now()
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) {
        return { id: 'network', status: 'fail', detail: `Server responded ${res.status}` }
      }
      await res.json()
      samples.push(performance.now() - t0)
    } catch {
      return { id: 'network', status: 'fail', detail: 'Could not reach the server' }
    }
  }
  samples.sort((a, b) => a - b)
  const median = Math.round(samples[1])
  if (median < 250) return { id: 'network', status: 'pass', metric: median, detail: `${median} ms` }
  if (median < 800)
    return { id: 'network', status: 'warn', metric: median, detail: `${median} ms — slower than recommended` }
  return { id: 'network', status: 'fail', metric: median, detail: `${median} ms — connection too slow` }
}

export async function runWebRtcCheck(): Promise<CheckResult> {
  if (typeof RTCPeerConnection === 'undefined') {
    return { id: 'webrtc', status: 'fail', detail: 'WebRTC not supported' }
  }
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  })
  try {
    pc.createDataChannel('readiness')
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    const result = await new Promise<CheckResult>((resolve) => {
      let resolved = false
      const finish = (r: CheckResult) => {
        if (resolved) return
        resolved = true
        resolve(r)
      }
      pc.onicecandidate = (ev) => {
        if (!ev.candidate) return
        const t = ev.candidate.type
        if (t === 'srflx' || t === 'relay') {
          finish({ id: 'webrtc', status: 'pass', detail: `Reachable (${t})` })
        }
      }
      setTimeout(() => {
        finish({
          id: 'webrtc',
          status: 'fail',
          detail: 'No reachable WebRTC candidates — your network may block UDP',
        })
      }, 4000)
    })
    return result
  } finally {
    pc.close()
  }
}

export async function runWebSocketCheck(): Promise<CheckResult> {
  const cfg = getRuntimeConfig()
  // LiveKit serves HTTP on the same port as WebSocket. An HTTP probe is silent
  // (no browser console noise) and works regardless of auth — any response,
  // including 404, proves the gateway is reachable.
  const httpUrl = cfg.livekitUrl
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 3000)
  try {
    const res = await fetch(httpUrl, {
      method: 'GET',
      signal: controller.signal,
      mode: 'no-cors',
    })
    if (res.type === 'opaque' || (res.status >= 100 && res.status < 600)) {
      return { id: 'websocket', status: 'pass', detail: 'Realtime gateway reachable' }
    }
    return { id: 'websocket', status: 'fail', detail: 'No response from gateway' }
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { id: 'websocket', status: 'fail', detail: 'Realtime gateway timed out' }
    }
    return {
      id: 'websocket',
      status: 'fail',
      detail: 'Could not reach the realtime gateway',
    }
  } finally {
    clearTimeout(timer)
  }
}

export type MediaTestStartResult =
  | { ok: true; session: MediaTestSession }
  | { ok: false; skipped: boolean; detail: string }

export async function startMediaTestSession(): Promise<MediaTestStartResult> {
  try {
    const session = await apiClient.startMediaTest()
    return { ok: true, session }
  } catch (err: any) {
    if (err?.statusCode === 429) {
      return {
        ok: false,
        skipped: true,
        detail: err.message || 'Try again in a moment.',
      }
    }
    return {
      ok: false,
      skipped: false,
      detail: 'Could not start the audio test session.',
    }
  }
}

export async function runLivekitPublishCheck(
  session: MediaTestSession,
): Promise<CheckResult> {
  const room = new Room()
  let track: Awaited<ReturnType<typeof createLocalAudioTrack>> | null = null
  try {
    await room.connect(session.livekitUrl, session.publisherToken)
    if (room.state !== ConnectionState.Connected) {
      return {
        id: 'livekitPublish',
        status: 'fail',
        detail: 'Could not connect to the realtime gateway.',
      }
    }
    track = await createLocalAudioTrack()
    const publication = await room.localParticipant.publishTrack(track)

    await new Promise((r) => setTimeout(r, 2500))

    const sender = publication.track?.sender
    if (!sender) {
      return {
        id: 'livekitPublish',
        status: 'fail',
        detail: 'Track did not publish — check microphone access.',
      }
    }
    const stats = await sender.getStats()
    let bytesSent = 0
    let packetsSent = 0
    stats.forEach((report: any) => {
      if (report.type === 'outbound-rtp' && report.kind === 'audio') {
        if (typeof report.bytesSent === 'number')
          bytesSent = Math.max(bytesSent, report.bytesSent)
        if (typeof report.packetsSent === 'number')
          packetsSent = Math.max(packetsSent, report.packetsSent)
      }
    })

    if (bytesSent > 0 && packetsSent > 0) {
      return {
        id: 'livekitPublish',
        status: 'pass',
        metric: bytesSent,
        detail: `Audio reaching server (${packetsSent} packets)`,
      }
    }
    return {
      id: 'livekitPublish',
      status: 'fail',
      detail: 'No audio reached the server. Your network may block real-time audio.',
    }
  } catch (err) {
    return {
      id: 'livekitPublish',
      status: 'fail',
      detail: (err as Error).message || 'Audio publishing failed.',
    }
  } finally {
    try {
      track?.stop()
    } catch {}
    try {
      await room.disconnect()
    } catch {}
  }
}

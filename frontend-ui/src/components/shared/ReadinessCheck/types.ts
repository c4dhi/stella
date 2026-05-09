export type CheckId =
  | 'browser'
  | 'network'
  | 'webrtc'
  | 'websocket'
  | 'micPermission'
  | 'micLevel'
  | 'livekitPublish'
  | 'audioOutput'

export type CheckStatus = 'pending' | 'running' | 'pass' | 'warn' | 'fail' | 'skipped'

export interface CheckResult {
  id: CheckId
  status: CheckStatus
  detail?: string
  metric?: number
}

export interface ReadinessResult {
  ready: boolean
  checks: CheckResult[]
}

export type ReadinessMode = 'public' | 'preflight' | 'gate'

export interface ReadinessCheckProps {
  mode?: ReadinessMode
  enabledChecks?: CheckId[]
  requiredChecks?: CheckId[]
  autoStart?: boolean
  onComplete?: (result: ReadinessResult) => void
  onChange?: (result: ReadinessResult) => void
}

export const DEFAULT_ENABLED_CHECKS: Record<ReadinessMode, CheckId[]> = {
  public: ['browser', 'network', 'webrtc', 'websocket', 'micPermission', 'micLevel', 'audioOutput'],
  preflight: ['browser', 'network', 'webrtc', 'websocket', 'micPermission', 'micLevel', 'audioOutput'],
  gate: ['browser', 'network', 'webrtc', 'websocket', 'micPermission', 'micLevel', 'audioOutput'],
}

export const DEFAULT_REQUIRED_CHECKS: Record<ReadinessMode, CheckId[]> = {
  public: [],
  preflight: ['browser', 'micPermission', 'micLevel'],
  gate: ['browser', 'micPermission', 'micLevel', 'webrtc', 'websocket', 'audioOutput'],
}

export const INTERACTIVE_CHECKS: ReadonlyArray<CheckId> = ['micLevel', 'audioOutput']

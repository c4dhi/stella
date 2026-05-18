export interface InjectionAgentTypeInput {
  slug: string
  defaultConfig?: Record<string, unknown> | null
  configSchema?: Record<string, unknown> | null
}

export interface InjectionAgentConfigurationInput {
  configuration?: Record<string, unknown> | null
}

export interface PodEnvBuildInput {
  agentId: string
  sessionId: string
  agentName: string
  agentIcon: string
  agentType: string
  grpcServerAddress: string
  sttServiceAddress: string
  ttsServiceAddress: string
  stateMachineAddress: string
  nodeEnv: string
}

export interface SecretDataBuildInput {
  agentId: string
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
  roomName: string
  ttsProvider: string
  ttsLanguage?: string
  agentConfig: Record<string, unknown>
  customEnvVars?: Record<string, string>
}

export interface PodInjectionResult {
  // Exact env list injected directly in the container spec (non-secret values).
  envVars: Array<{ name: string; value: string }>
  // Exact secret stringData injected via envFrom (includes AGENT_CONFIG and API keys).
  secretStringData: Record<string, string>
  agentConfig: Record<string, unknown>
  agentConfigJson: string
  // Report-only output for validation/observability; callers can decide enforcement policy.
  missingRequiredEnvVars: string[]
  appliedOptionalDefaults: string[]
}

interface AgentOptionalEnvVarSpec {
  name: string
  default?: string
}

export interface ResolvedAgentEnvVars {
  resolvedEnvVars: Record<string, string>
  missingRequiredEnvVars: string[]
  appliedOptionalDefaults: string[]
}

/**
 * Build the exact container env var list injected into the pod spec.
 * Keep order deterministic so tests can assert exact payloads.
 */
export function buildPodEnvVars(input: PodEnvBuildInput): Array<{ name: string; value: string }> {
  return [
    { name: 'AGENT_ID', value: input.agentId },
    { name: 'SESSION_ID', value: input.sessionId },
    { name: 'AGENT_NAME', value: input.agentName },
    { name: 'AGENT_ICON', value: input.agentIcon },
    { name: 'AGENT_TYPE', value: input.agentType },
    { name: 'GRPC_SERVER', value: input.grpcServerAddress },
    { name: 'AGENT_IDENTITY', value: `agent-${input.agentId}` },
    { name: 'STT_SERVICE_ADDRESS', value: input.sttServiceAddress },
    { name: 'TTS_SERVICE_ADDRESS', value: input.ttsServiceAddress },
    { name: 'STATE_MACHINE_ADDRESS', value: input.stateMachineAddress },
    { name: 'NODE_ENV', value: input.nodeEnv },
  ]
}

/**
 * Build the exact secret stringData map injected into the pod via envFrom.
 * Includes AGENT_CONFIG JSON plus merged custom environment variables.
 */
export function buildSecretStringData(input: SecretDataBuildInput): Record<string, string> {
  const agentConfigJson = JSON.stringify(input.agentConfig || {})

  const base: Record<string, string> = {
    LIVEKIT_URL: input.livekitUrl,
    LIVEKIT_API_KEY: input.livekitApiKey,
    LIVEKIT_API_SECRET: input.livekitApiSecret,
    ROOM_NAME: input.roomName,
    IDENTITY: `agent-${input.agentId}`,
    TTS_PROVIDER: input.ttsProvider,
    AGENT_CONFIG: agentConfigJson,
  }
  if (input.ttsLanguage) {
    base.TTS_LANGUAGE = input.ttsLanguage
  }
  return {
    ...base,
    ...(input.customEnvVars || {}),
  }
}

/**
 * Derive effective agent config from AgentType defaults and user configuration.
 * User values override defaults with deep object merge semantics.
 */
export function deriveEffectiveAgentConfig(
  agentType: InjectionAgentTypeInput,
  userConfiguration: InjectionAgentConfigurationInput | null | undefined,
): Record<string, unknown> {
  const defaults = (agentType.defaultConfig || {}) as Record<string, unknown>
  const overrides = (userConfiguration?.configuration || {}) as Record<string, unknown>
  return deepMerge(defaults, overrides)
}

/**
 * Test-oriented helper that returns the exact env vars and AGENT_CONFIG payload
 * a pod would receive for a given AgentType + user AgentConfiguration combination.
 */
export function buildPodInjectionFromAgentTypeAndConfiguration(
  params: {
    agentType: InjectionAgentTypeInput
    userConfiguration?: InjectionAgentConfigurationInput | null
    podEnv: PodEnvBuildInput
    secret: Omit<SecretDataBuildInput, 'agentConfig'>
  },
): PodInjectionResult {
  const agentConfig = deriveEffectiveAgentConfig(params.agentType, params.userConfiguration)
  // Resolve required/optional env vars from configSchema using provided env vars as highest precedence.
  const envResolution = resolveAgentEnvVarsFromConfigSchema(
    params.agentType.configSchema,
    params.secret.customEnvVars || {},
  )
  const envVars = buildPodEnvVars(params.podEnv)
  const secretStringData = buildSecretStringData({
    ...params.secret,
    agentConfig,
    customEnvVars: envResolution.resolvedEnvVars,
  })

  return {
    envVars,
    secretStringData,
    agentConfig,
    agentConfigJson: secretStringData.AGENT_CONFIG,
    missingRequiredEnvVars: envResolution.missingRequiredEnvVars,
    appliedOptionalDefaults: envResolution.appliedOptionalDefaults,
  }
}

/**
 * Resolve environment variable requirements declared in configSchema extensions:
 * - `x-stella-env-vars` (required)
 * - `x-stella-optional-env-vars` (optional defaults)
 *
 * Precedence: provided env vars > optional defaults.
 */
export function resolveAgentEnvVarsFromConfigSchema(
  configSchema: Record<string, unknown> | null | undefined,
  providedEnvVars: Record<string, string>,
): ResolvedAgentEnvVars {
  const requiredEnvVars = extractRequiredEnvVars(configSchema)
  const optionalEnvVars = extractOptionalEnvVars(configSchema)
  // Start from provided values (template + request overrides already merged by caller).
  const resolvedEnvVars: Record<string, string> = { ...providedEnvVars }
  const appliedOptionalDefaults: string[] = []

  for (const optionalVar of optionalEnvVars) {
    // Do not override a provided value; defaults are only fallback values.
    if (resolvedEnvVars[optionalVar.name] === undefined && optionalVar.default !== undefined) {
      resolvedEnvVars[optionalVar.name] = optionalVar.default
      appliedOptionalDefaults.push(optionalVar.name)
    }
  }

  const missingRequiredEnvVars = requiredEnvVars.filter((name) => resolvedEnvVars[name] === undefined)

  return {
    resolvedEnvVars,
    missingRequiredEnvVars,
    appliedOptionalDefaults,
  }
}

function extractRequiredEnvVars(configSchema: Record<string, unknown> | null | undefined): string[] {
  if (!configSchema) return []
  const raw = configSchema['x-stella-env-vars']
  if (!Array.isArray(raw)) return []
  // Ignore malformed non-string entries defensively.
  return raw.filter((value): value is string => typeof value === 'string')
}

function extractOptionalEnvVars(configSchema: Record<string, unknown> | null | undefined): AgentOptionalEnvVarSpec[] {
  if (!configSchema) return []
  const raw = configSchema['x-stella-optional-env-vars']
  if (!Array.isArray(raw)) return []
  // Ignore malformed entries and keep only objects with a string `name`.
  return raw
    .filter((value) => typeof value === 'object' && value !== null)
    .map((value) => value as AgentOptionalEnvVarSpec)
    .filter((value) => typeof value.name === 'string')
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base }

  for (const [key, value] of Object.entries(override)) {
    const existing = result[key]

    // Deep-merge plain objects; arrays and scalars are replaced by override value.
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMerge(existing, value)
    } else {
      result[key] = value
    }
  }

  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

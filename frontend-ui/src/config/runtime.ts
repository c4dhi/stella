// Runtime Configuration
// This allows the frontend to load configuration at runtime instead of build-time
// enabling the same build to work in different environments (local dev, K8s, etc.)

export interface RuntimeConfig {
  apiUrl: string
  livekitUrl: string
}

// Global window interface extension
declare global {
  interface Window {
    __ENV__?: Partial<RuntimeConfig>
  }
}

// Helper to log only in development mode
const devLog = (...args: any[]) => {
  if (import.meta.env.DEV) {
    console.log(...args)
  }
}

// Default configuration (fallback for local development)
const DEFAULT_CONFIG: RuntimeConfig = {
  apiUrl: 'http://localhost:3000',
  livekitUrl: 'ws://localhost:7880',
}

let runtimeConfig: RuntimeConfig | null = null

/**
 * Check if URL contains internal Kubernetes service names
 */
function isInternalServiceUrl(url: string): boolean {
  return url.includes('session-management-server') || url.includes('livekit:')
}

/**
 * Auto-detect URLs based on window.location.hostname
 * This allows the same build to work from phone, localhost, or any network location
 */
function autoDetectUrls(): RuntimeConfig {
  const hostname = window.location.hostname
  devLog(`[RuntimeConfig] Auto-detecting URLs for hostname: ${hostname}`)

  const config = {
    apiUrl: `http://${hostname}:3000`,
    livekitUrl: `ws://${hostname}:7880`,
  }

  devLog(`[RuntimeConfig] Auto-detected config:`, config)
  return config
}

/**
 * Initialize runtime configuration
 * Should be called once at app startup
 */
export async function initRuntimeConfig(): Promise<RuntimeConfig> {
  devLog('[RuntimeConfig] Initializing runtime configuration...')
  devLog('[RuntimeConfig] Current hostname:', window.location.hostname)
  devLog('[RuntimeConfig] window.__ENV__ exists:', !!window.__ENV__)

  // Try to load from window.__ENV__ (injected by config.js in production)
  if (window.__ENV__ && typeof window.__ENV__ === 'object') {
    devLog('[RuntimeConfig] Loading from window.__ENV__:', window.__ENV__)
    const config = {
      ...DEFAULT_CONFIG,
      ...(window.__ENV__ as Partial<RuntimeConfig>),
    } as RuntimeConfig

    devLog('[RuntimeConfig] Merged config:', config)

    // Check if we need to auto-detect (internal K8s service names won't work from browser)
    if (isInternalServiceUrl(config.apiUrl) || isInternalServiceUrl(config.livekitUrl)) {
      devLog('[RuntimeConfig] ✓ Detected internal K8s service names')
      devLog('[RuntimeConfig] ✓ Auto-detecting URLs based on hostname...')
      runtimeConfig = autoDetectUrls()
      devLog('[RuntimeConfig] ✓ Final config with auto-detected URLs:', runtimeConfig)
      return runtimeConfig
    }

    devLog('[RuntimeConfig] ✓ Using config as-is (no internal names detected)')
    runtimeConfig = config
    return runtimeConfig
  }

  // Try to fetch from /config.js (served by nginx in production)
  // This is a fallback if the script tag didn't load it
  devLog('[RuntimeConfig] window.__ENV__ not found, trying to fetch /config.js...')
  try {
    const response = await fetch('/config.js')
    if (response.ok) {
      devLog('[RuntimeConfig] Successfully fetched /config.js')
      // Execute the config script which sets window.__ENV__
      const scriptText = await response.text()
      eval(scriptText)

      if (window.__ENV__ && typeof window.__ENV__ === 'object') {
        devLog('[RuntimeConfig] Loaded from /config.js fetch:', window.__ENV__)
        const config = {
          ...DEFAULT_CONFIG,
          ...(window.__ENV__ as Partial<RuntimeConfig>),
        } as RuntimeConfig

        // Check if we need to auto-detect
        if (isInternalServiceUrl(config.apiUrl) || isInternalServiceUrl(config.livekitUrl)) {
          devLog('[RuntimeConfig] ✓ Detected internal K8s service names from fetch')
          devLog('[RuntimeConfig] ✓ Auto-detecting URLs...')
          runtimeConfig = autoDetectUrls()
          devLog('[RuntimeConfig] ✓ Final config with auto-detected URLs:', runtimeConfig)
          return runtimeConfig
        }

        runtimeConfig = config
        return runtimeConfig
      }
    } else {
      devLog('[RuntimeConfig] Failed to fetch /config.js, status:', response.status)
    }
  } catch (error) {
    devLog('[RuntimeConfig] Failed to fetch /config.js:', error)
  }

  // Fallback to environment variables (Vite dev mode) or auto-detect
  devLog('[RuntimeConfig] Falling back to Vite env vars or auto-detection')
  const envConfig = {
    apiUrl: import.meta.env.VITE_API_URL || DEFAULT_CONFIG.apiUrl,
    livekitUrl: import.meta.env.VITE_LIVEKIT_URL || DEFAULT_CONFIG.livekitUrl,
  } as RuntimeConfig

  devLog('[RuntimeConfig] Env config:', envConfig)

  // Check if we need to auto-detect
  if (isInternalServiceUrl(envConfig.apiUrl) || isInternalServiceUrl(envConfig.livekitUrl)) {
    devLog('[RuntimeConfig] ✓ Detected internal K8s service names in env config')
    devLog('[RuntimeConfig] ✓ Auto-detecting URLs...')
    runtimeConfig = autoDetectUrls()
    devLog('[RuntimeConfig] ✓ Final config with auto-detected URLs:', runtimeConfig)
    return runtimeConfig
  }

  devLog('[RuntimeConfig] ✓ Using env config as-is')
  runtimeConfig = envConfig
  return runtimeConfig
}

/**
 * Get runtime configuration
 * Must call initRuntimeConfig() first at app startup
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    devLog('[RuntimeConfig] Configuration not initialized, returning defaults')
    return DEFAULT_CONFIG
  }
  return runtimeConfig
}

/**
 * Get specific config value
 */
export function getConfigValue<K extends keyof RuntimeConfig>(key: K): RuntimeConfig[K] {
  return getRuntimeConfig()[key]
}

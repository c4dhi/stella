// Runtime Configuration
// This allows the frontend to load configuration at runtime instead of build-time
// enabling the same build to work in different environments (local dev, K8s, etc.)

export interface RuntimeConfig {
  apiUrl: string
  livekitUrl: string
  livekitApiKey: string
  livekitApiSecret: string
}

// Global window interface extension
declare global {
  interface Window {
    __ENV__?: Partial<RuntimeConfig>
  }
}

// Default configuration (fallback for local development)
const DEFAULT_CONFIG: RuntimeConfig = {
  apiUrl: 'http://localhost:3000',
  livekitUrl: 'ws://localhost:7880',
  livekitApiKey: 'devkey',
  livekitApiSecret: 'secret',
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
  console.log(`[RuntimeConfig] Auto-detecting URLs for hostname: ${hostname}`)

  const config = {
    apiUrl: `http://${hostname}:3000`,
    livekitUrl: `ws://${hostname}:7880`,
    livekitApiKey: 'devkey',
    livekitApiSecret: 'secret',
  }

  console.log(`[RuntimeConfig] Auto-detected config:`, config)
  return config
}

/**
 * Initialize runtime configuration
 * Should be called once at app startup
 */
export async function initRuntimeConfig(): Promise<RuntimeConfig> {
  console.log('[RuntimeConfig] Initializing runtime configuration...')
  console.log('[RuntimeConfig] Current hostname:', window.location.hostname)
  console.log('[RuntimeConfig] window.__ENV__ exists:', !!window.__ENV__)

  // Try to load from window.__ENV__ (injected by config.js in production)
  if (window.__ENV__ && typeof window.__ENV__ === 'object') {
    console.log('[RuntimeConfig] Loading from window.__ENV__:', window.__ENV__)
    const config = {
      ...DEFAULT_CONFIG,
      ...(window.__ENV__ as Partial<RuntimeConfig>),
    } as RuntimeConfig

    console.log('[RuntimeConfig] Merged config:', config)

    // Check if we need to auto-detect (internal K8s service names won't work from browser)
    if (isInternalServiceUrl(config.apiUrl) || isInternalServiceUrl(config.livekitUrl)) {
      console.log('[RuntimeConfig] ✓ Detected internal K8s service names')
      console.log('[RuntimeConfig] ✓ Auto-detecting URLs based on hostname...')
      const detectedConfig = autoDetectUrls()
      // Keep API keys from config, but use detected URLs
      runtimeConfig = {
        ...detectedConfig,
        livekitApiKey: config.livekitApiKey,
        livekitApiSecret: config.livekitApiSecret,
      }
      console.log('[RuntimeConfig] ✓ Final config with auto-detected URLs:', runtimeConfig)
      return runtimeConfig
    }

    console.log('[RuntimeConfig] ✓ Using config as-is (no internal names detected)')
    runtimeConfig = config
    return runtimeConfig
  }

  // Try to fetch from /config.js (served by nginx in production)
  // This is a fallback if the script tag didn't load it
  console.log('[RuntimeConfig] window.__ENV__ not found, trying to fetch /config.js...')
  try {
    const response = await fetch('/config.js')
    if (response.ok) {
      console.log('[RuntimeConfig] Successfully fetched /config.js')
      // Execute the config script which sets window.__ENV__
      const scriptText = await response.text()
      eval(scriptText)

      if (window.__ENV__ && typeof window.__ENV__ === 'object') {
        console.log('[RuntimeConfig] Loaded from /config.js fetch:', window.__ENV__)
        const config = {
          ...DEFAULT_CONFIG,
          ...(window.__ENV__ as Partial<RuntimeConfig>),
        } as RuntimeConfig

        // Check if we need to auto-detect
        if (isInternalServiceUrl(config.apiUrl) || isInternalServiceUrl(config.livekitUrl)) {
          console.log('[RuntimeConfig] ✓ Detected internal K8s service names from fetch')
          console.log('[RuntimeConfig] ✓ Auto-detecting URLs...')
          const detectedConfig = autoDetectUrls()
          runtimeConfig = {
            ...detectedConfig,
            livekitApiKey: config.livekitApiKey,
            livekitApiSecret: config.livekitApiSecret,
          }
          console.log('[RuntimeConfig] ✓ Final config with auto-detected URLs:', runtimeConfig)
          return runtimeConfig
        }

        runtimeConfig = config
        return runtimeConfig
      }
    } else {
      console.warn('[RuntimeConfig] Failed to fetch /config.js, status:', response.status)
    }
  } catch (error) {
    console.warn('[RuntimeConfig] Failed to fetch /config.js:', error)
  }

  // Fallback to environment variables (Vite dev mode) or auto-detect
  console.log('[RuntimeConfig] Falling back to Vite env vars or auto-detection')
  const envConfig = {
    apiUrl: import.meta.env.VITE_API_URL || DEFAULT_CONFIG.apiUrl,
    livekitUrl: import.meta.env.VITE_LIVEKIT_URL || DEFAULT_CONFIG.livekitUrl,
    livekitApiKey: import.meta.env.VITE_LIVEKIT_API_KEY || DEFAULT_CONFIG.livekitApiKey,
    livekitApiSecret: import.meta.env.VITE_LIVEKIT_API_SECRET || DEFAULT_CONFIG.livekitApiSecret,
  } as RuntimeConfig

  console.log('[RuntimeConfig] Env config:', envConfig)

  // Check if we need to auto-detect
  if (isInternalServiceUrl(envConfig.apiUrl) || isInternalServiceUrl(envConfig.livekitUrl)) {
    console.log('[RuntimeConfig] ✓ Detected internal K8s service names in env config')
    console.log('[RuntimeConfig] ✓ Auto-detecting URLs...')
    const detectedConfig = autoDetectUrls()
    runtimeConfig = {
      ...detectedConfig,
      livekitApiKey: envConfig.livekitApiKey,
      livekitApiSecret: envConfig.livekitApiSecret,
    }
    console.log('[RuntimeConfig] ✓ Final config with auto-detected URLs:', runtimeConfig)
    return runtimeConfig
  }

  console.log('[RuntimeConfig] ✓ Using env config as-is')
  runtimeConfig = envConfig
  return runtimeConfig
}

/**
 * Get runtime configuration
 * Must call initRuntimeConfig() first at app startup
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    console.warn('[RuntimeConfig] Configuration not initialized, returning defaults')
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

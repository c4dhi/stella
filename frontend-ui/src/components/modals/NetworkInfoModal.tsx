import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { apiClient } from '../../services/ApiClient'
import { useStore } from '../../store'
import { useThemeStore } from '../../store/themeStore'
import type { NetworkInfoResponse } from '../../lib/api-types'

interface NetworkInfoModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function NetworkInfoModal({ isOpen, onClose }: NetworkInfoModalProps) {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfoResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const llmConfig = useStore(s => s.llmConfig)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    if (isOpen) {
      loadNetworkInfo()
    }
  }, [isOpen])

  const loadNetworkInfo = async () => {
    try {
      setLoading(true)
      setError(null)
      const info = await apiClient.getNetworkInfo()
      setNetworkInfo(info)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load network info')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className={`card-elevated relative w-full max-w-2xl overflow-hidden ${
            isDark ? 'bg-surface-dark-secondary' : ''
          }`}
        >
          {/* Header */}
          <div className={`px-6 py-4 border-b ${isDark ? 'border-border-dark' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-heading ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                Network Information
              </h2>
              <button
                onClick={onClose}
                className={`p-2 rounded-lg transition-colors ${
                  isDark
                    ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                    : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-6 max-h-[70vh] overflow-y-auto scrollbar-thin">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className={`text-body ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                  Loading network information...
                </div>
              </div>
            )}

            {error && (
              <div className={`p-4 rounded-lg text-body ${
                isDark
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {error}
              </div>
            )}

            {!loading && !error && networkInfo && (
              <div className="space-y-6">
                {/* Environment Badge */}
                <div className="flex items-center gap-2">
                  <span className="badge-neutral uppercase">
                    {networkInfo.environment}
                  </span>
                  <span className={`text-caption ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                    ({networkInfo.source})
                  </span>
                </div>

                {/* QR Code for Frontend */}
                <div className={`flex flex-col items-center gap-3 p-6 rounded-xl ${
                  isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                }`}>
                  <div className={`text-body ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                    Scan to access from mobile
                  </div>
                  <div className="p-4 bg-white rounded-lg shadow-sm">
                    <QRCodeSVG value={networkInfo.frontendUrl} size={200} level="M" />
                  </div>
                  <div className={`text-caption font-mono break-all text-center ${
                    isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                  }`}>
                    {networkInfo.frontendUrl}
                  </div>
                </div>

                {/* Connection Details */}
                <div className="space-y-3">
                  <h3 className={`text-body font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                    Connection Details
                  </h3>

                  <div className="grid gap-3">
                    {/* Frontend URL */}
                    <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                      isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                    }`}>
                      <div className={`text-label uppercase ${
                        isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                      }`}>
                        Frontend
                      </div>
                      <div className={`text-body-sm font-mono break-all ${
                        isDark ? 'text-content-inverse' : 'text-content'
                      }`}>
                        {networkInfo.frontendUrl}
                      </div>
                    </div>

                    {/* Backend API URL */}
                    <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                      isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                    }`}>
                      <div className={`text-label uppercase ${
                        isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                      }`}>
                        Backend API
                      </div>
                      <div className={`text-body-sm font-mono break-all ${
                        isDark ? 'text-content-inverse' : 'text-content'
                      }`}>
                        {networkInfo.serverUrl}
                      </div>
                    </div>

                    {/* LiveKit URL */}
                    <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                      isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                    }`}>
                      <div className={`text-label uppercase ${
                        isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                      }`}>
                        LiveKit Server
                      </div>
                      <div className={`text-body-sm font-mono break-all ${
                        isDark ? 'text-content-inverse' : 'text-content'
                      }`}>
                        {networkInfo.livekitUrl}
                      </div>
                    </div>

                    {/* Detected IP */}
                    <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                      isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                    }`}>
                      <div className={`text-label uppercase ${
                        isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                      }`}>
                        Detected IP
                      </div>
                      <div className={`text-body-sm font-mono ${
                        isDark ? 'text-content-inverse' : 'text-content'
                      }`}>
                        {networkInfo.detectedIp}
                      </div>
                    </div>
                  </div>
                </div>

                {/* System Info */}
                <div className={`pt-3 border-t ${isDark ? 'border-border-dark' : 'border-border'}`}>
                  <div className="grid grid-cols-2 gap-3 text-caption">
                    <div>
                      <span className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>Hostname: </span>
                      <span className={`font-mono ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                        {networkInfo.hostname}
                      </span>
                    </div>
                    <div>
                      <span className={isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}>Platform: </span>
                      <span className={`font-mono ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                        {networkInfo.platform}
                      </span>
                    </div>
                  </div>
                </div>

                {/* LLM Configuration */}
                {llmConfig && (
                  <div className={`pt-3 border-t ${isDark ? 'border-border-dark' : 'border-border'}`}>
                    <h3 className={`text-body font-medium mb-3 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                      AI Configuration
                    </h3>
                    <div className="grid gap-3">
                      {/* Provider and Model */}
                      <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                        isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                      }`}>
                        <div className={`text-label uppercase ${
                          isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                        }`}>
                          Provider & Model
                        </div>
                        <div className={`text-body-sm font-mono ${
                          isDark ? 'text-content-inverse' : 'text-content'
                        }`}>
                          {llmConfig.provider} / {llmConfig.model}
                        </div>
                      </div>

                      {/* Base URL (if local) */}
                      {llmConfig.base_url && (
                        <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                          isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                        }`}>
                          <div className={`text-label uppercase ${
                            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                          }`}>
                            Base URL
                          </div>
                          <div className={`text-body-sm font-mono break-all ${
                            isDark ? 'text-content-inverse' : 'text-content'
                          }`}>
                            {llmConfig.base_url}
                          </div>
                        </div>
                      )}

                      {/* Settings */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                          isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                        }`}>
                          <div className={`text-label uppercase ${
                            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                          }`}>
                            Temperature
                          </div>
                          <div className={`text-body-sm font-mono ${
                            isDark ? 'text-content-inverse' : 'text-content'
                          }`}>
                            {llmConfig.temperature}
                          </div>
                        </div>
                        <div className={`flex flex-col gap-1 p-3 rounded-lg ${
                          isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                        }`}>
                          <div className={`text-label uppercase ${
                            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                          }`}>
                            Max Tokens
                          </div>
                          <div className={`text-body-sm font-mono ${
                            isDark ? 'text-content-inverse' : 'text-content'
                          }`}>
                            {llmConfig.max_tokens}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Instructions */}
                <div className={`p-4 rounded-lg text-body-sm space-y-2 ${
                  isDark
                    ? 'bg-primary-900/30 border border-primary-500/20 text-primary-300'
                    : 'bg-primary-50 border border-primary-200 text-primary-800'
                }`}>
                  <div className="font-medium">Access from your phone:</div>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>Make sure your phone is on the same WiFi network</li>
                    <li>Scan the QR code above or manually enter the frontend URL</li>
                    <li>Login with your credentials</li>
                  </ol>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className={`px-6 py-4 border-t flex justify-end ${isDark ? 'border-border-dark' : 'border-border'}`}>
            <button
              onClick={onClose}
              className="btn-ghost"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

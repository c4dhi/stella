import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { apiClient } from '../../services/ApiClient'
import { useStore } from '../../store'
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
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-2xl bg-white/95 backdrop-blur-xl rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] border border-neutral-200/60 overflow-hidden"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-neutral-200/60">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-light text-neutral-900 tracking-wide">
                Network Information
              </h2>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100/80 transition-all"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-6 max-h-[70vh] overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="text-sm text-neutral-400 font-light">Loading network information...</div>
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl bg-red-50/80 border border-red-200/60 text-red-600 text-sm font-light">
                {error}
              </div>
            )}

            {!loading && !error && networkInfo && (
              <div className="space-y-6">
                {/* Environment Badge */}
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-xs font-light bg-neutral-100 text-neutral-700 tracking-wider uppercase">
                    {networkInfo.environment}
                  </span>
                  <span className="text-xs text-neutral-400 font-light">
                    ({networkInfo.source})
                  </span>
                </div>

                {/* QR Code for Frontend */}
                <div className="flex flex-col items-center gap-3 p-6 rounded-xl bg-neutral-50/80 border border-neutral-200/40">
                  <div className="text-sm font-light text-neutral-600 tracking-wide">
                    Scan to access from mobile
                  </div>
                  <div className="p-4 bg-white rounded-lg shadow-sm">
                    <QRCodeSVG value={networkInfo.frontendUrl} size={200} level="M" />
                  </div>
                  <div className="text-xs text-neutral-400 font-mono break-all text-center">
                    {networkInfo.frontendUrl}
                  </div>
                </div>

                {/* Connection Details */}
                <div className="space-y-3">
                  <h3 className="text-sm font-normal text-neutral-700 tracking-wide">Connection Details</h3>

                  <div className="grid gap-3">
                    {/* Frontend URL */}
                    <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                      <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                        Frontend
                      </div>
                      <div className="text-sm font-mono text-neutral-900 break-all">
                        {networkInfo.frontendUrl}
                      </div>
                    </div>

                    {/* Backend API URL */}
                    <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                      <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                        Backend API
                      </div>
                      <div className="text-sm font-mono text-neutral-900 break-all">
                        {networkInfo.serverUrl}
                      </div>
                    </div>

                    {/* LiveKit URL */}
                    <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                      <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                        LiveKit Server
                      </div>
                      <div className="text-sm font-mono text-neutral-900 break-all">
                        {networkInfo.livekitUrl}
                      </div>
                    </div>

                    {/* Detected IP */}
                    <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                      <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                        Detected IP
                      </div>
                      <div className="text-sm font-mono text-neutral-900">
                        {networkInfo.detectedIp}
                      </div>
                    </div>
                  </div>
                </div>

                {/* System Info */}
                <div className="pt-3 border-t border-neutral-200/60">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-neutral-500 font-light">Hostname: </span>
                      <span className="text-neutral-700 font-mono">{networkInfo.hostname}</span>
                    </div>
                    <div>
                      <span className="text-neutral-500 font-light">Platform: </span>
                      <span className="text-neutral-700 font-mono">{networkInfo.platform}</span>
                    </div>
                  </div>
                </div>

                {/* LLM Configuration */}
                {llmConfig && (
                  <div className="pt-3 border-t border-neutral-200/60">
                    <h3 className="text-sm font-normal text-neutral-700 tracking-wide mb-3">AI Configuration</h3>
                    <div className="grid gap-3">
                      {/* Provider and Model */}
                      <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                        <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                          Provider & Model
                        </div>
                        <div className="text-sm font-mono text-neutral-900">
                          {llmConfig.provider} / {llmConfig.model}
                        </div>
                      </div>

                      {/* Base URL (if local) */}
                      {llmConfig.base_url && (
                        <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                          <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                            Base URL
                          </div>
                          <div className="text-sm font-mono text-neutral-900 break-all">
                            {llmConfig.base_url}
                          </div>
                        </div>
                      )}

                      {/* Settings */}
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                          <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                            Temperature
                          </div>
                          <div className="text-sm font-mono text-neutral-900">
                            {llmConfig.temperature}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 p-3 rounded-lg bg-neutral-50/50 border border-neutral-200/40">
                          <div className="text-xs text-neutral-500 font-light tracking-wider uppercase">
                            Max Tokens
                          </div>
                          <div className="text-sm font-mono text-neutral-900">
                            {llmConfig.max_tokens}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Instructions */}
                <div className="p-4 rounded-xl bg-blue-50/80 border border-blue-200/40 text-sm text-blue-800 font-light space-y-2">
                  <div className="font-normal">📱 Access from your phone:</div>
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
          <div className="px-6 py-4 border-t border-neutral-200/60 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-light tracking-wider text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80 transition-all"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

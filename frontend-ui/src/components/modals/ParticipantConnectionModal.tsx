import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { apiClient } from '../../services/ApiClient'
import { useThemeStore } from '../../store/themeStore'
import type { ParticipantConnectionInfoResponse } from '../../lib/api-types'
import { getRuntimeConfig } from '../../config/runtime'

interface ParticipantConnectionModalProps {
  participantId: string
  onClose: () => void
}

export default function ParticipantConnectionModal({
  participantId,
  onClose,
}: ParticipantConnectionModalProps) {
  const [connectionInfo, setConnectionInfo] = useState<ParticipantConnectionInfoResponse | null>(null)
  const [serverUrl, setServerUrl] = useState<string>(getRuntimeConfig().apiUrl)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    loadConnectionInfo()
  }, [participantId])

  const loadConnectionInfo = async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Fetch both connection info and network info in parallel
      const [connectionData, networkData] = await Promise.all([
        apiClient.getParticipantConnectionInfo(participantId),
        apiClient.getNetworkInfo(),
      ])

      setConnectionInfo(connectionData)
      setServerUrl(networkData.serverUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load connection info')
    } finally {
      setIsLoading(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    // Could add toast notification here
  }

  // Generate QR code data - contains JWT token for authentication
  // Mobile app will use token to authenticate and fetch connection info
  const qrCodeData = connectionInfo?.token ? JSON.stringify({
    serverUrl: serverUrl,
    token: connectionInfo.token, // JWT token for participant authentication
  }) : ''

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`
            backdrop-blur-xl rounded-[20px] w-full max-w-4xl p-8
            ${isDark
              ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
              : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
            }
          `}
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="text-center py-8">
              <div className={`text-sm font-light ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>Loading connection info...</div>
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <div className={`text-sm font-light ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</div>
              <button
                onClick={onClose}
                className={`
                  mt-4 px-4 py-2 rounded-xl text-sm font-light tracking-wider
                  transition-all duration-200
                  ${isDark
                    ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                    : 'bg-neutral-900 text-white hover:bg-neutral-800'
                  }
                `}
              >
                Close
              </button>
            </div>
          ) : connectionInfo ? (
            <>
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h2 className={`text-2xl font-light mb-2 ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                    Connection Information
                  </h2>
                  <p className={`text-sm font-light ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                    {connectionInfo.participantName}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className={`
                    p-2 rounded-lg transition-all duration-200
                    ${isDark
                      ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/10'
                      : 'text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100'
                    }
                  `}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="flex gap-8">
                {/* Connection Details */}
                <div className="flex-1 space-y-5">
                  {/* Session Server URL */}
                  <div>
                    <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                      Session Server URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={serverUrl}
                        readOnly
                        className={`
                          flex-1 px-4 py-2.5 rounded-xl text-sm font-mono font-light focus:outline-none
                          ${isDark
                            ? 'bg-zinc-800 border border-zinc-700 text-zinc-100'
                            : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900'
                          }
                        `}
                      />
                      <button
                        onClick={() => copyToClipboard(serverUrl, 'Session Server URL')}
                        className={`
                          px-3 py-2.5 rounded-lg text-xs font-light
                          transition-all duration-200 flex-shrink-0
                          ${isDark
                            ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                          }
                        `}
                        title="Copy to clipboard"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* JWT Token */}
                  <div>
                    <label className={`block text-xs font-light tracking-wider uppercase mb-2 ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
                      Authentication Token
                    </label>
                    <div className="flex gap-2">
                      <textarea
                        rows={5}
                        value={connectionInfo?.token || ''}
                        readOnly
                        className={`
                          flex-1 px-4 py-2.5 rounded-xl text-sm font-mono font-light
                          focus:outline-none resize-none break-all
                          ${isDark
                            ? 'bg-zinc-800 border border-zinc-700 text-zinc-100'
                            : 'bg-neutral-50/50 border border-neutral-200/60 text-neutral-900'
                          }
                        `}
                      />
                      <button
                        onClick={() => copyToClipboard(connectionInfo?.token || '', 'Authentication Token')}
                        className={`
                          px-3 py-2.5 rounded-lg text-xs font-light
                          transition-all duration-200 flex-shrink-0 self-start
                          ${isDark
                            ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                          }
                        `}
                        title="Copy to clipboard"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </div>
                  </div>

                </div>

                {/* QR Code */}
                <div className="flex-shrink-0 flex flex-col items-center gap-4">
                  <div className={`
                    p-6 rounded-xl shadow-sm
                    ${isDark
                      ? 'bg-white'
                      : 'bg-white border border-neutral-200/60'
                    }
                  `}>
                    <QRCodeSVG
                      value={qrCodeData}
                      size={300}
                      level="H"
                      includeMargin={false}
                    />
                  </div>
                  <p className={`text-xs font-light tracking-wider uppercase text-center ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                    Scan to connect
                  </p>
                </div>
              </div>

              <div className={`mt-6 pt-6 border-t ${isDark ? 'border-zinc-800' : 'border-neutral-200/60'}`}>
                <button
                  onClick={onClose}
                  className={`
                    w-full py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                    transition-all duration-200
                    ${isDark
                      ? 'bg-white/10 text-white hover:bg-white/20 border border-white/10'
                      : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]'
                    }
                  `}
                >
                  Close
                </button>
              </div>
            </>
          ) : null}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

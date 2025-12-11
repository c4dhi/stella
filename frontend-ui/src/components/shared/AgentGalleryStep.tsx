import { useState, useEffect } from 'react'
import { useThemeStore } from '../../store/themeStore'
import { apiClient } from '../../services/ApiClient'
import AgentGalleryCard from '../agents/AgentGalleryCard'
import { AgentUploadCard, MyAgentsSection } from '../agents'
import type { AgentType, CustomAgentType, AgentUploadResponse } from '../../lib/api-types'

type GalleryTab = 'builtin' | 'myagents'

interface AgentGalleryStepProps {
  selectedAgentType: AgentType | null
  onSelectAgentType: (type: AgentType) => void
  showMyAgentsTab?: boolean
  showUpload?: boolean
  onUploadComplete?: (result: AgentUploadResponse) => void
}

export default function AgentGalleryStep({
  selectedAgentType,
  onSelectAgentType,
  showMyAgentsTab = true,
  showUpload = true,
  onUploadComplete,
}: AgentGalleryStepProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const [galleryTab, setGalleryTab] = useState<GalleryTab>('builtin')
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [isLoadingTypes, setIsLoadingTypes] = useState(false)
  const [uploadRefreshTrigger, setUploadRefreshTrigger] = useState(0)
  const [showUploadView, setShowUploadView] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Fetch agent types on mount
  useEffect(() => {
    setIsLoadingTypes(true)
    apiClient.getAgentTypes()
      .then((types) => {
        setAgentTypes(types)
      })
      .catch((err) => {
        console.error('Failed to fetch agent types:', err)
        setAgentTypes([
          {
            id: 'echo-agent',
            slug: 'echo-agent',
            name: 'Echo Agent',
            description: 'Simple test agent that echoes user input',
            icon: '🔊',
            version: '1.0.0',
            isBuiltIn: true,
            capabilities: ['voice', 'text'],
            defaultConfig: {}
          }
        ])
      })
      .finally(() => setIsLoadingTypes(false))
  }, [])

  const handleSelectCustomAgent = (agent: CustomAgentType) => {
    onSelectAgentType(agent as AgentType)
  }

  const handleUploadComplete = (result: AgentUploadResponse) => {
    setUploadRefreshTrigger(prev => prev + 1)
    setGalleryTab('myagents')
    setShowUploadView(false)
    onUploadComplete?.(result)
  }

  // Upload view
  if (showUploadView) {
    return (
      <div>
        <AgentUploadCard
          onUploadComplete={handleUploadComplete}
          onError={(err) => setUploadError(err)}
        />
        {uploadError && (
          <div className={`mt-4 p-3 rounded-lg text-xs font-light ${isDark
            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
            : 'bg-red-50/80 border border-red-200/60 text-red-600'
          }`}>
            {uploadError}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowUploadView(false)}
          className={`
            w-full mt-4 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
            transition-all duration-200
            ${isDark
              ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
              : 'bg-neutral-100/80 text-neutral-600 hover:bg-neutral-200/80'
            }
          `}
        >
          <span className="flex items-center justify-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Gallery
          </span>
        </button>
      </div>
    )
  }

  return (
    <div>
      {/* Tab bar - only show if myagents tab is enabled */}
      {showMyAgentsTab && (
        <div className={`flex gap-1 p-1 rounded-lg mb-4 ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-100'}`}>
          <button
            onClick={() => setGalleryTab('builtin')}
            className={`
              flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all
              ${galleryTab === 'builtin'
                ? isDark ? 'bg-zinc-600 text-white' : 'bg-white text-neutral-900 shadow-sm'
                : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-neutral-500 hover:text-neutral-700'
              }
            `}
          >
            Built-in Agents
          </button>
          <button
            onClick={() => setGalleryTab('myagents')}
            className={`
              flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all
              ${galleryTab === 'myagents'
                ? isDark ? 'bg-zinc-600 text-white' : 'bg-white text-neutral-900 shadow-sm'
                : isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-neutral-500 hover:text-neutral-700'
              }
            `}
          >
            My Agents
          </button>
        </div>
      )}

      {galleryTab === 'builtin' ? (
        <>
          {isLoadingTypes ? (
            <div className={`h-48 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Loading agent types...
              </div>
            </div>
          ) : agentTypes.length === 0 ? (
            <div className={`h-48 flex items-center justify-center text-sm ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
              No agent types available
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 max-h-[350px] overflow-y-auto overflow-x-visible pr-2 pt-1 -mt-1">
              {agentTypes.filter(t => t.isBuiltIn).map((type) => (
                <AgentGalleryCard
                  key={type.id}
                  agentType={type}
                  isSelected={selectedAgentType?.id === type.id}
                  onClick={() => onSelectAgentType(type)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-4">
          {/* Upload button */}
          {showUpload && (
            <button
              type="button"
              onClick={() => setShowUploadView(true)}
              className={`
                w-full p-4 rounded-xl text-left transition-all duration-200
                border-2 border-dashed hover:border-solid
                ${isDark
                  ? 'border-zinc-600 hover:border-primary-500 bg-zinc-800/30 hover:bg-zinc-700/50'
                  : 'border-neutral-300 hover:border-neutral-900 bg-neutral-50/50 hover:bg-neutral-100'
                }
              `}
            >
              <div className="flex items-center gap-3">
                <div className={`
                  w-10 h-10 rounded-lg flex items-center justify-center
                  ${isDark ? 'bg-zinc-700' : 'bg-neutral-100'}
                `}>
                  <svg
                    className={`w-5 h-5 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M12 16V4m0 0l-4 4m4-4l4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3 20h18" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <h3 className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-neutral-700'}`}>
                    Upload New Agent
                  </h3>
                  <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}>
                    Upload a custom agent package (.zip)
                  </p>
                </div>
              </div>
            </button>
          )}

          <MyAgentsSection
            onSelectAgent={handleSelectCustomAgent}
            refreshTrigger={uploadRefreshTrigger}
          />
        </div>
      )}
    </div>
  )
}

import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useProjectMetrics } from '../../hooks/useProjectMetrics'
import { Bot, Users, MessageSquare, Activity, Zap, Clock, Globe, Lock } from 'lucide-react'

interface ProjectOverviewBannerProps {
  projectId: string
  isPublic?: boolean
}

/**
 * Animated metric card component
 */
interface MetricCardProps {
  label: string
  value: number
  icon: React.ReactNode
  live?: boolean
  highlight?: boolean
}

function MetricCard({ label, value, icon, live, highlight }: MetricCardProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="flex flex-col items-center gap-1 px-4">
      <div className="flex items-center gap-2">
        <span className={`${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
          {icon}
        </span>
        <AnimatePresence mode="wait">
          <motion.span
            key={value}
            initial={{ opacity: 0.5, scale: 1.1, y: -2 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0.5, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={`text-2xl font-semibold tabular-nums ${highlight
                ? isDark
                  ? 'text-emerald-400'
                  : 'text-emerald-600'
                : isDark
                  ? 'text-white'
                  : 'text-neutral-900'
              }`}
          >
            {formatNumber(value)}
          </motion.span>
        </AnimatePresence>
        {live && (
          <motion.span
            className={`w-2 h-2 rounded-full ${isDark ? 'bg-emerald-400' : 'bg-emerald-500'
              }`}
            animate={{
              opacity: [0.5, 1, 0.5],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        )}
      </div>
      <span
        className={`text-[11px] font-medium tracking-wide uppercase ${isDark ? 'text-zinc-500' : 'text-neutral-500'
          }`}
      >
        {label}
      </span>
    </div>
  )
}

/**
 * Live connection indicator
 */
function LiveIndicator({ connected }: { connected: boolean }) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  return (
    <div className="flex items-center gap-2">
      <motion.div
        className={`w-2 h-2 rounded-full ${connected
            ? isDark
              ? 'bg-emerald-400'
              : 'bg-emerald-500'
            : isDark
              ? 'bg-zinc-600'
              : 'bg-neutral-400'
          }`}
        animate={
          connected
            ? {
              boxShadow: [
                '0 0 0 0 rgba(52, 211, 153, 0.4)',
                '0 0 0 4px rgba(52, 211, 153, 0)',
              ],
            }
            : {}
        }
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeOut',
        }}
      />
      <span
        className={`text-xs font-medium ${connected
            ? isDark
              ? 'text-emerald-400'
              : 'text-emerald-600'
            : isDark
              ? 'text-zinc-500'
              : 'text-neutral-500'
          }`}
      >
        {connected ? 'Live' : 'Connecting...'}
      </span>
    </div>
  )
}

/**
 * Format large numbers for display (e.g., 1.2k)
 */
function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  }
  return num.toString()
}

/**
 * ProjectOverviewBanner - Premium animated banner for public projects
 *
 * Displays real-time metrics including:
 * - Deployed agent type and plan template
 * - Active sessions count
 * - Online participants
 * - Running agents
 * - Total messages
 */
export function ProjectOverviewBanner({ projectId, isPublic = false }: ProjectOverviewBannerProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const { metrics, isLoading, isConnected } = useProjectMetrics(projectId)

  // Don't render if loading or no metrics
  if (isLoading || !metrics) {
    return (
      <div className="max-w-6xl mx-auto px-6 pt-6">
        <div
          className={`h-[120px] rounded-2xl animate-pulse ${isDark ? 'bg-zinc-800/50' : 'bg-neutral-100'
            }`}
        />
      </div>
    )
  }

  const agentName = metrics.project.agentTypeName || 'Default Agent'
  const planName = metrics.project.planTemplateName

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-6xl mx-auto px-6 pt-6"
    >
      <motion.div
        className={`relative overflow-hidden rounded-2xl border backdrop-blur-xl transition-all duration-300 ${isDark
            ? 'bg-gradient-to-br from-zinc-900/90 via-zinc-800/90 to-zinc-900/90 border-zinc-700/60 hover:border-zinc-600/80'
            : 'bg-gradient-to-br from-white/95 via-neutral-50/95 to-white/95 border-neutral-200/60 hover:border-neutral-300/80 shadow-[0_1px_30px_rgba(0,0,0,0.04)]'
          }`}
        whileHover={{ scale: 1.002 }}
        transition={{ duration: 0.2 }}
      >
        {/* Subtle gradient overlay */}
        <div
          className={`absolute inset-0 opacity-30 pointer-events-none ${isDark
              ? 'bg-gradient-to-r from-violet-500/10 via-transparent to-emerald-500/10'
              : 'bg-gradient-to-r from-violet-500/5 via-transparent to-emerald-500/5'
            }`}
        />

        <div className="relative flex items-center justify-between p-5">
          {isPublic ? (
            <>
              {/* Left: Agent Info with Public Badge (only for public projects) */}
              <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
                <motion.div
                  className={`flex items-center justify-center w-12 h-12 rounded-xl ${isDark
                      ? 'bg-violet-500/20 text-violet-400'
                      : 'bg-violet-100 text-violet-600'
                    }`}
                  transition={{ duration: 0.2 }}
                >
                  <Bot className="w-6 h-6" />
                </motion.div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p
                      className={`text-[10px] font-medium tracking-wider uppercase ${isDark ? 'text-zinc-500' : 'text-neutral-500'
                        }`}
                    >
                      Deployed Agent
                    </p>
                    {/* Public Badge */}
                    <div
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide ${isDark
                          ? 'bg-violet-500/20 text-violet-400'
                          : 'bg-violet-100 text-violet-600'
                        }`}
                    >
                      <Globe className="w-2.5 h-2.5" />
                      Public
                    </div>
                  </div>
                  <p
                    className={`text-base font-semibold truncate ${isDark ? 'text-white' : 'text-neutral-900'
                      }`}
                  >
                    {agentName}
                  </p>
                  {planName && (
                    <p
                      className={`text-xs truncate ${isDark ? 'text-zinc-500' : 'text-neutral-500'
                        }`}
                    >
                      Plan: {planName}
                    </p>
                  )}
                </div>
              </div>

              {/* Center: Metrics Grid (for public projects) */}
              <div className="flex items-center gap-2 sm:gap-4 flex-grow justify-center">
                <div
                  className={`h-12 w-px ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-200/80'
                    }`}
                />

                <MetricCard
                  label="Active"
                  value={metrics.sessions.active}
                  icon={<Activity className="w-4 h-4" />}
                  highlight={metrics.sessions.active > 0}
                />

                <MetricCard
                  label="Online"
                  value={metrics.participants.online}
                  icon={<Users className="w-4 h-4" />}
                  live={metrics.participants.online > 0}
                  highlight={metrics.participants.online > 0}
                />

                <MetricCard
                  label="Agents"
                  value={metrics.agents.running}
                  icon={<Zap className="w-4 h-4" />}
                  highlight={metrics.agents.running > 0}
                />

                <MetricCard
                  label="Messages"
                  value={metrics.messages.total}
                  icon={<MessageSquare className="w-4 h-4" />}
                />

                <div
                  className={`h-12 w-px ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-200/80'
                    }`}
                />
              </div>
            </>
          ) : (
            <>
              {/* Left: Private Badge + Metrics (for private projects) */}
              <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
                {/* Private Badge */}
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${isDark
                      ? 'bg-zinc-700/50 text-zinc-400'
                      : 'bg-neutral-100 text-neutral-500'
                    }`}
                >
                  <Lock className="w-3.5 h-3.5" />
                  Private
                </div>

                <div
                  className={`h-12 w-px ${isDark ? 'bg-zinc-700/50' : 'bg-neutral-200/80'
                    }`}
                />

                {/* Metrics on the left for private projects */}
                <div className="flex items-center gap-2 sm:gap-4">
                  <MetricCard
                    label="Active"
                    value={metrics.sessions.active}
                    icon={<Activity className="w-4 h-4" />}
                    highlight={metrics.sessions.active > 0}
                  />

                  <MetricCard
                    label="Online"
                    value={metrics.participants.online}
                    icon={<Users className="w-4 h-4" />}
                    live={metrics.participants.online > 0}
                    highlight={metrics.participants.online > 0}
                  />

                  <MetricCard
                    label="Agents"
                    value={metrics.agents.running}
                    icon={<Zap className="w-4 h-4" />}
                    highlight={metrics.agents.running > 0}
                  />

                  <MetricCard
                    label="Messages"
                    value={metrics.messages.total}
                    icon={<MessageSquare className="w-4 h-4" />}
                  />
                </div>
              </div>

              {/* Spacer for private projects */}
              <div className="flex-grow" />
            </>
          )}

          {/* Right: Status Indicator (same for both) */}
          <div className="flex flex-col items-end gap-2 flex-shrink-0">
            <LiveIndicator connected={isConnected} />
            <div className="flex items-center gap-1.5">
              <Clock className={`w-3 h-3 ${isDark ? 'text-zinc-600' : 'text-neutral-400'}`} />
              <span
                className={`text-[10px] ${isDark ? 'text-zinc-600' : 'text-neutral-400'
                  }`}
              >
                Updated {new Date(metrics.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

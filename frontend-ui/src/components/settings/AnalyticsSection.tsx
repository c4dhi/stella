import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useAgentMetrics, useMetricsTimeline } from '../../hooks/useAgentMetrics'
import { apiClient } from '../../services/ApiClient'
import StatsCard from './admin/StatsCard'
import LatencyStageChart from './analytics/LatencyStageChart'
import ResponseTimeTimeline from './analytics/ResponseTimeTimeline'
import type { ProjectWithCounts, AgentType } from '../../lib/api-types'
import { useNavigate } from 'react-router-dom'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
}

const DAY_OPTIONS = [7, 30, 90] as const

export default function AnalyticsSection() {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'
  const navigate = useNavigate()

  // Selector state
  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null)
  const [days, setDays] = useState<number>(30)

  // Fetch projects and agent types on mount
  useEffect(() => {
    apiClient.listProjects().then((p) => {
      setProjects(p)
      if (p.length > 0 && !selectedProjectId) setSelectedProjectId(p[0].id)
    }).catch(() => {})
    apiClient.getAgentTypes().then((a) => {
      setAgentTypes(a)
      if (a.length > 0 && !selectedAgentSlug) setSelectedAgentSlug(a[0].slug)
    }).catch(() => {})
  }, [])

  const { data, isLoading, error } = useAgentMetrics(selectedProjectId, selectedAgentSlug, days)

  // Pick best stage for live timeline: prefer ttfab, fall back to total, then first available
  const timelineStage = data?.stages.find(s => s.stage === 'ttfab')
    ? 'ttfab'
    : data?.stages.find(s => s.stage === 'total')
      ? 'total'
      : data?.stages[0]?.stage || 'ttfab'
  const { points: timelinePoints } = useMetricsTimeline(selectedProjectId, selectedAgentSlug, timelineStage)

  const selectClass = `rounded-lg px-3 py-2 text-sm ${
    isDark
      ? 'bg-surface-dark-tertiary text-content-inverse border border-border-dark'
      : 'bg-white text-content border border-neutral-200'
  }`

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6 pb-12"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2 className={`text-heading-lg ${isDark ? 'text-content-inverse' : 'text-content'}`}>
          Analytics
        </h2>
        <p className={`mt-1 text-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
          Agent performance metrics and latency analysis
        </p>
      </motion.div>

      {/* Selectors */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
        <select
          value={selectedProjectId || ''}
          onChange={(e) => setSelectedProjectId(e.target.value || null)}
          className={selectClass}
        >
          <option value="">Select project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <select
          value={selectedAgentSlug || ''}
          onChange={(e) => setSelectedAgentSlug(e.target.value || null)}
          className={selectClass}
        >
          <option value="">Select agent type</option>
          {agentTypes.map((a) => (
            <option key={a.slug} value={a.slug}>{a.name}</option>
          ))}
        </select>

        <div className={`flex rounded-lg overflow-hidden text-xs ${isDark ? 'bg-surface-dark-tertiary' : 'bg-neutral-100'}`}>
          {DAY_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-2 transition-colors ${
                days === d
                  ? isDark ? 'bg-purple-600 text-white' : 'bg-neutral-900 text-white'
                  : isDark ? 'text-content-inverse-secondary hover:text-content-inverse' : 'text-content-secondary hover:text-content'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </motion.div>

      {/* Loading / Error */}
      {isLoading && (
        <motion.div variants={itemVariants} className={`rounded-xl p-8 text-center ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'}`}>
          <p className={isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}>Loading metrics...</p>
        </motion.div>
      )}

      {error && (
        <motion.div variants={itemVariants} className="rounded-xl p-4 bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          {error}
        </motion.div>
      )}

      {/* Stats cards */}
      {data && !isLoading && (
        <>
          {(() => {
            const ttfab = data.stages.find(s => s.stage === 'ttfab')
            const agentTtft = data.stages.find(s => s.stage === 'agent_ttft')
            return (
              <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatsCard
                  title="Total Sessions"
                  value={data.totalSessions}
                  color="purple"
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                      <path d="M16 3h-8v4h8V3z" />
                    </svg>
                  }
                />
                <StatsCard
                  title="Total Turns"
                  value={data.totalTurns}
                  color="blue"
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  }
                />
                <StatsCard
                  title="TTFAB P50"
                  value={ttfab ? Math.round(ttfab.p50_ms) : 0}
                  subtitle={ttfab ? `P95: ${Math.round(ttfab.p95_ms)}ms` : 'No data'}
                  color="orange"
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                  }
                />
                <StatsCard
                  title="Agent TTFT P50"
                  value={agentTtft ? Math.round(agentTtft.p50_ms) : 0}
                  subtitle={agentTtft ? `P95: ${Math.round(agentTtft.p95_ms)}ms` : 'No data'}
                  color="green"
                  icon={
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                    </svg>
                  }
                />
              </motion.div>
            )
          })()}

          {/* Live response time timeline */}
          <motion.div variants={itemVariants}>
            <ResponseTimeTimeline points={timelinePoints} />
          </motion.div>

          {/* CUI paper metrics summary */}
          {data.summary && (
            <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard
                title="Safety Interception"
                value={data.summary.safetyRouting ? Math.round(data.summary.safetyRouting.interceptionRate * 100) : 0}
                subtitle={data.summary.safetyRouting ? `${data.summary.safetyRouting.unsafeTurns}/${data.summary.safetyRouting.totalTurns} turns` : 'No data'}
                color="orange"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                }
              />
              <StatsCard
                title="Plan Completion"
                value={data.summary.planCompletion ? Math.round(data.summary.planCompletion.avgCompletionRate * 100) : 0}
                subtitle={data.summary.planCompletion ? `${data.summary.planCompletion.completedPlans}/${data.summary.planCompletion.totalSessions} plans` : 'No data'}
                color="green"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                }
              />
              <StatsCard
                title="Transition Accuracy"
                value={data.summary.stateTransitions ? Math.round(data.summary.stateTransitions.accuracy * 100) : 0}
                subtitle={data.summary.stateTransitions ? `${data.summary.stateTransitions.expectedTransitions}/${data.summary.stateTransitions.totalTransitions}` : 'No data'}
                color="blue"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                }
              />
              <StatsCard
                title="Bridge Avg Duration"
                value={data.summary.bridgeGeneration ? Math.round(data.summary.bridgeGeneration.avgBridgeDuration_ms) : 0}
                subtitle={data.summary.bridgeGeneration ? `${data.summary.bridgeGeneration.totalBridges} bridges` : 'No data'}
                color="cyan"
                icon={
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 9l4-4 4 4" />
                    <path d="M9 5v12a4 4 0 0 0 4 4h6" />
                  </svg>
                }
              />
            </motion.div>
          )}

          {/* Stage latency chart */}
          <motion.div variants={itemVariants}>
            <LatencyStageChart stages={data.stages} />
          </motion.div>

          {/* Outlier sessions */}
          <motion.div variants={itemVariants}>
            <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'}`}>
              <div className={`flex items-center gap-2 px-5 py-3 border-b ${isDark ? 'border-border-dark' : 'border-neutral-200'}`}>
                <h3 className={`text-sm font-semibold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                  Outlier Sessions
                </h3>
                {data.outlierSessions.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-600">
                    {data.outlierSessions.length}
                  </span>
                )}
              </div>
              <div className="p-5">
                {data.outlierSessions.length === 0 ? (
                  <p className={`text-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                    No outlier sessions detected (threshold: 2x global P50)
                  </p>
                ) : (
                  <div className="space-y-3">
                    {data.outlierSessions.map((session) => (
                      <button
                        key={session.sessionId}
                        onClick={() => navigate(`/session/${session.sessionId}`)}
                        className={`w-full text-left rounded-lg p-3 transition-colors ${
                          isDark
                            ? 'bg-surface-dark-tertiary hover:bg-surface-dark-tertiary/80'
                            : 'bg-neutral-50 hover:bg-neutral-100'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`text-sm font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                            {session.sessionName}
                          </span>
                          <span className={`text-xs ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                            {new Date(session.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {session.outlierStages.map((os) => (
                            <span
                              key={os.stage}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono bg-amber-500/10 text-amber-600"
                            >
                              {os.stage}: {os.sessionMean_ms.toFixed(0)}ms
                              <span className="opacity-60">vs {os.globalP50_ms.toFixed(0)}ms p50</span>
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}

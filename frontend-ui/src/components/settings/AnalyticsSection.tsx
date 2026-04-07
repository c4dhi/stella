import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useAgentMetrics } from '../../hooks/useAgentMetrics'
import { useStageDataPoints } from '../../hooks/useStageDataPoints'
import { apiClient } from '../../services/ApiClient'
import StageTimeline from './analytics/StageTimeline'
import SessionAnalyticsModal from '../modals/SessionAnalyticsModal'
import type { ProjectWithCounts, AgentType } from '../../lib/api-types'

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

  // Selector state
  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [agentTypes, setAgentTypes] = useState<AgentType[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedAgentSlug, setSelectedAgentSlug] = useState<string | null>(null)
  const [days, setDays] = useState<number>(30)

  // Timeline drill-down state
  const [selectedStage, setSelectedStage] = useState<string | null>(null)

  // Session analytics modal state
  const [modalSessionId, setModalSessionId] = useState<string | null>(null)

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

  // Date range for drill-down
  const dateRange = useMemo(() => {
    const to = new Date().toISOString()
    const from = new Date(Date.now() - days * 86400000).toISOString()
    return { from, to }
  }, [days])

  // Lazy-load raw data points when a stage is selected
  const { points: stageDataPoints } = useStageDataPoints(
    selectedProjectId,
    selectedAgentSlug,
    selectedStage,
    dateRange.from,
    dateRange.to,
  )

  // Reset selected stage when changing agent/project/days
  useEffect(() => {
    setSelectedStage(null)
  }, [selectedProjectId, selectedAgentSlug, days])

  const selectClass = `rounded-lg px-3 py-2 text-sm ${
    isDark
      ? 'bg-surface-dark-tertiary text-content-inverse border border-border-dark'
      : 'bg-white text-content border border-neutral-200'
  }`

  // Plan completion data from summary
  const planCompletion = data?.summary?.planCompletion

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

        {data && (
          <span className={`text-xs tabular-nums ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
            {data.totalSessions} session{data.totalSessions !== 1 ? 's' : ''} · {data.totalTurns} turn{data.totalTurns !== 1 ? 's' : ''}
          </span>
        )}
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

      {data && !isLoading && (
        <>
          {/* Pipeline Timeline */}
          <motion.div variants={itemVariants}>
            <StageTimeline
              stages={data.stages}
              mode="aggregate"
              selectedStage={selectedStage}
              onStageSelect={setSelectedStage}
              selectedStagePoints={stageDataPoints}
              onSessionClick={setModalSessionId}
            />
          </motion.div>

          {/* Plan Completion */}
          {planCompletion && (
            <motion.div variants={itemVariants}>
              <div className={`rounded-xl overflow-hidden ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200'}`}>
                <div className={`px-5 py-3 border-b ${isDark ? 'border-border-dark' : 'border-neutral-200'}`}>
                  <h3 className={`text-sm font-semibold ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                    Plan Completion
                  </h3>
                </div>
                <div className="p-5">
                  <div className="flex items-center gap-6">
                    {/* Completion rate bar */}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-2xl font-bold tabular-nums ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                          {Math.round(planCompletion.avgCompletionRate * 100)}%
                        </span>
                        <span className={`text-xs ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                          {planCompletion.completedPlans}/{planCompletion.totalSessions} plans completed
                        </span>
                      </div>
                      <div className={`h-2 rounded-full overflow-hidden ${isDark ? 'bg-surface-dark-tertiary' : 'bg-neutral-100'}`}>
                        <div
                          className="h-full rounded-full bg-green-500 transition-all duration-500"
                          style={{ width: `${Math.round(planCompletion.avgCompletionRate * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </>
      )}

      {/* Session Analytics Modal */}
      <SessionAnalyticsModal
        isOpen={modalSessionId != null}
        onClose={() => setModalSessionId(null)}
        sessionId={modalSessionId || ''}
      />
    </motion.div>
  )
}

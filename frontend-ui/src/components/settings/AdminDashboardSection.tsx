import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { useAdminDashboardStream, useUsageHistory, useAllSessions } from '../../hooks/useAdminMetrics'
import { useServerMetricsStream } from '../../hooks/useServerMetrics'
import StatsCard from './admin/StatsCard'
import SessionsGrid from './admin/SessionsGrid'
import ServerPerformanceMonitor from './admin/ServerPerformanceMonitor'
import HistoricalUsageCharts from './admin/HistoricalUsageCharts'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as const,
    },
  },
}

// Icons for stats cards
const UsersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const BotIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="16" x2="8" y2="16" />
    <line x1="16" y1="16" x2="16" y2="16" />
  </svg>
)

const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
)

const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
)

const LayersIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
)

const MessagesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export default function AdminDashboardSection() {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Real-time dashboard metrics
  const { metrics, isConnected, error: dashboardError } = useAdminDashboardStream()

  // Server performance metrics
  const {
    currentMetrics: serverMetrics,
    metricsHistory,
    isConnected: serverConnected,
  } = useServerMetricsStream()

  // All sessions data
  const { sessions, isLoading: sessionsLoading } = useAllSessions()

  // Historical usage data
  const [historyDays, setHistoryDays] = useState(30)
  const {
    data: historyData,
    isLoading: historyLoading,
  } = useUsageHistory(historyDays)

  const handleRangeChange = useCallback((days: number) => {
    setHistoryDays(days)
  }, [])

  return (
    <motion.div
      className="max-w-6xl space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h2
          className={`text-heading-lg mb-2 ${
            isDark ? 'text-content-inverse' : 'text-content'
          }`}
        >
          Admin Dashboard
        </h2>
        <div className="flex items-center gap-4">
          <p
            className={`text-body-sm ${
              isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
            }`}
          >
            Real-time platform monitoring and metrics
          </p>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span
              className={`text-caption ${
                isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
              }`}
            >
              {isConnected ? 'Connected' : 'Reconnecting...'}
            </span>
          </div>
        </div>
        {dashboardError && (
          <p className="text-caption text-red-500 mt-1">{dashboardError}</p>
        )}
      </motion.div>

      {/* Stats Cards - Row 1: Core Metrics */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Active Participants"
          value={metrics?.activeParticipants ?? 0}
          subtitle={`of ${metrics?.totalParticipants ?? 0} total`}
          icon={<UsersIcon />}
          color="blue"
        />
        <StatsCard
          title="Active Agents"
          value={(metrics?.runningAgents ?? 0) + (metrics?.startingAgents ?? 0)}
          subtitle={
            metrics?.startingAgents
              ? `${metrics.runningAgents} running, ${metrics.startingAgents} starting`
              : `${metrics?.runningAgents ?? 0} running`
          }
          icon={<BotIcon />}
          color="green"
        />
        <StatsCard
          title="Active Sessions"
          value={metrics?.activeSessions ?? 0}
          subtitle={`of ${metrics?.totalSessions ?? 0} total`}
          icon={<LayersIcon />}
          color="purple"
        />
        <StatsCard
          title="Messages Today"
          value={metrics?.messagesToday ?? 0}
          subtitle={`${(metrics?.totalMessages ?? 0).toLocaleString()} total`}
          icon={<MessagesIcon />}
          color="orange"
        />
      </motion.div>

      {/* Stats Cards - Row 2: Agent Auto-Stop Metrics */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatsCard
          title="Paused Agents"
          value={metrics?.pausedAgents ?? 0}
          subtitle="Stopped due to inactivity"
          icon={<PauseIcon />}
          color="yellow"
        />
        <StatsCard
          title="Stopped Agents"
          value={metrics?.stoppedAgents ?? 0}
          subtitle={`${metrics?.failedAgents ?? 0} failed`}
          icon={<BotIcon />}
          color="gray"
        />
        <StatsCard
          title="Auto-Stop Enabled"
          value={metrics?.sessionsWithTimeout ?? 0}
          subtitle="Active sessions with timeout"
          icon={<ClockIcon />}
          color="cyan"
        />
      </motion.div>

      {/* Server Performance Monitor - Full Width */}
      <motion.div variants={itemVariants}>
        <ServerPerformanceMonitor
          currentMetrics={serverMetrics}
          metricsHistory={metricsHistory}
          isConnected={serverConnected}
        />
      </motion.div>

      {/* Sessions Grid */}
      <motion.div variants={itemVariants}>
        <SessionsGrid sessions={sessions} isLoading={sessionsLoading} />
      </motion.div>

      {/* Historical Usage Charts */}
      <motion.div variants={itemVariants}>
        <HistoricalUsageCharts
          data={historyData}
          isLoading={historyLoading}
          onRangeChange={handleRangeChange}
        />
      </motion.div>

      {/* Paused Agents Info */}
      {metrics && metrics.pausedAgents > 0 && (
        <motion.div
          variants={itemVariants}
          className={`p-4 rounded-xl border ${
            isDark
              ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
              : 'bg-yellow-50 border-yellow-200 text-yellow-700'
          }`}
        >
          <div className="flex items-center gap-3">
            <PauseIcon />
            <div>
              <p className="font-medium">
                {metrics.pausedAgents} agent{metrics.pausedAgents > 1 ? 's' : ''} paused
              </p>
              <p
                className={`text-caption ${
                  isDark ? 'text-yellow-400/70' : 'text-yellow-600'
                }`}
              >
                Agents stopped due to user inactivity. They will auto-restart when users rejoin.
              </p>
            </div>
          </div>
        </motion.div>
      )}

      {/* Failed Agents Warning */}
      {metrics && metrics.failedAgents > 0 && (
        <motion.div
          variants={itemVariants}
          className={`p-4 rounded-xl border ${
            isDark
              ? 'bg-red-500/10 border-red-500/30 text-red-400'
              : 'bg-red-50 border-red-200 text-red-600'
          }`}
        >
          <div className="flex items-center gap-3">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div>
              <p className="font-medium">
                {metrics.failedAgents} agent{metrics.failedAgents > 1 ? 's' : ''} failed
              </p>
              <p
                className={`text-caption ${
                  isDark ? 'text-red-400/70' : 'text-red-500'
                }`}
              >
                Check agent logs for deployment errors
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

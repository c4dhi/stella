import { motion } from 'framer-motion'
import StatsCard from '../admin/StatsCard'
import type { MetricsSummary } from '../../../lib/api-types'

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const },
  },
}

interface SummaryCardsProps {
  summary: MetricsSummary
}

export default function SummaryCards({ summary }: SummaryCardsProps) {
  return (
    <>
      {/* Pipeline metrics */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          title="Safety Interception"
          value={summary.safetyRouting ? Math.round(summary.safetyRouting.interceptionRate * 100) : 0}
          suffix="%"
          subtitle={summary.safetyRouting ? `${summary.safetyRouting.unsafeTurns}/${summary.safetyRouting.totalTurns} turns` : 'No interceptions'}
          color="orange"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          }
        />
        <StatsCard
          title="Plan Completion"
          value={summary.planCompletion ? Math.round(summary.planCompletion.avgCompletionRate * 100) : 0}
          suffix="%"
          subtitle={summary.planCompletion ? `${summary.planCompletion.completedPlans}/${summary.planCompletion.totalSessions} plans` : 'No plans yet'}
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
          value={summary.stateTransitions ? Math.round(summary.stateTransitions.accuracy * 100) : 0}
          suffix="%"
          subtitle={summary.stateTransitions ? `${summary.stateTransitions.expectedTransitions}/${summary.stateTransitions.totalTransitions}` : 'No transitions yet'}
          color="blue"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          }
        />
      </motion.div>

      {/* Bridge / latency metrics */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatsCard
          title="Avg Time to Bridge"
          value={summary.bridgeGeneration ? Math.round(summary.bridgeGeneration.avgBridgeDuration_ms) : 0}
          suffix="ms"
          subtitle={summary.bridgeGeneration ? `VAD -> first audio · ${summary.bridgeGeneration.totalBridges} turns` : 'No data yet'}
          color="cyan"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 9l4-4 4 4" />
              <path d="M9 5v12a4 4 0 0 0 4 4h6" />
            </svg>
          }
        />
        <StatsCard
          title="Avg Bridge Duration"
          value={summary.bridgeDuration ? Math.round(summary.bridgeDuration.avg_ms) : 0}
          suffix="ms"
          subtitle={summary.bridgeDuration ? `${summary.bridgeDuration.count} bridges` : 'No data yet'}
          color="purple"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          }
        />
        <StatsCard
          title="Avg Time to Response"
          value={summary.ttfr ? Math.round(summary.ttfr.avg_ms) : 0}
          suffix="ms"
          subtitle={summary.ttfr ? `VAD -> first response audio · ${summary.ttfr.count} turns` : 'No data yet'}
          color="green"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />
      </motion.div>
    </>
  )
}

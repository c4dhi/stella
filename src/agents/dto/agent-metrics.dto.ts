export class StageLatencyDto {
  stage: string;
  count: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
}

export class OutlierStageDto {
  stage: string;
  sessionMean_ms: number;
  globalP50_ms: number;
}

export class OutlierSessionDto {
  sessionId: string;
  sessionName: string;
  createdAt: string;
  outlierStages: OutlierStageDto[];
}

export class MetricsSummaryDto {
  planCompletion: {
    totalSessions: number;
    completedPlans: number;
    avgCompletionRate: number;
  } | null;
  safetyRouting: {
    totalTurns: number;
    safeTurns: number;
    unsafeTurns: number;
    interceptionRate: number;
  } | null;
  stateTransitions: {
    totalTransitions: number;
    expectedTransitions: number;
    accuracy: number;
  } | null;
  bridgeGeneration: {
    totalBridges: number;
    avgBridgeDuration_ms: number;
  } | null;
  bridgeDuration: {
    count: number;
    avg_ms: number;
  } | null;
  ttfr: {
    count: number;
    avg_ms: number;
  } | null;
}

export class AgentMetricsResponseDto {
  agentSlug: string;
  projectId: string;
  dateRange: { from: string; to: string };
  totalSessions: number;
  totalTurns: number;
  stages: StageLatencyDto[];
  outlierSessions: OutlierSessionDto[];
  summary: MetricsSummaryDto;
}

export class SessionAnalyticsResponseDto {
  sessionId: string;
  totalTurns: number;
  stages: StageLatencyDto[];
  summary: MetricsSummaryDto;
}

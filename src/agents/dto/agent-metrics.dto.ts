export class StageLatencyDto {
  stage: string;
  count: number;
  mean_ms: number;
  p50_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
}

export class AgentMetricsResponseDto {
  agentSlug: string;
  projectId: string;
  dateRange: { from: string; to: string };
  totalSessions: number;
  totalTurns: number;
  stages: StageLatencyDto[];
}

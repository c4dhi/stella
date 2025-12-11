/**
 * Project Metrics DTO
 *
 * Provides real-time metrics for a project including sessions, agents,
 * participants, and messages. This is the foundation for the admin dashboard.
 */
export class ProjectMetricsDto {
  projectId: string;
  timestamp: string;

  sessions: {
    total: number;
    active: number;
    closed: number;
  };

  agents: {
    total: number;
    running: number;
    starting: number;
    failed: number;
    stopped: number;
  };

  participants: {
    total: number;
    online: number; // Based on lastSeenAt within 60 seconds
  };

  messages: {
    total: number;
    todayCount: number;
  };

  project: {
    name: string;
    agentType: string | null;
    agentTypeName: string | null;
    planTemplateName: string | null;
    isPublic: boolean;
    createdAt: string;
  };
}

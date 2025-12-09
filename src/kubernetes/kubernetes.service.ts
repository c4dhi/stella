import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as k8s from '@kubernetes/client-node';
import { AgentImageService } from '../agent-image/agent-image.service';
import { EnvVarTemplatesService } from '../env-var-templates/env-var-templates.service';

export interface AgentPodConfig {
  agentId: string;
  sessionId: string;
  projectId: string;
  userId: string;           // User ID for env var template access validation
  agentName: string;
  agentIcon: string;
  roomName: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  // API keys (OPENAI_API_KEY, etc.) provided via envVarTemplateId
  ttsProvider: string;
  agentConfig?: Record<string, unknown>;  // Agent-specific config (passed as AGENT_CONFIG env var)
  agentType?: string;       // Agent type (e.g., "stella-agent") - determines which image to use
  forceRebuild?: boolean;   // Force rebuild the agent image
  envVarTemplateId?: string; // Optional env var template for custom environment variables
}

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);
  private readonly kc: k8s.KubeConfig;
  private readonly k8sApi: k8s.CoreV1Api;
  private readonly namespace: string;
  private readonly defaultAgentType: string;
  private readonly imagePullPolicy: string;
  private readonly grpcServerAddress: string;

  constructor(
    private configService: ConfigService,
    private agentImageService: AgentImageService,
    private envVarTemplatesService: EnvVarTemplatesService,
  ) {
    this.namespace = this.configService.get<string>('KUBERNETES_NAMESPACE', 'default');
    this.defaultAgentType = this.configService.get<string>('DEFAULT_AGENT_TYPE', 'stella-agent');
    this.imagePullPolicy = this.configService.get<string>('AGENT_IMAGE_PULL_POLICY', 'IfNotPresent');
    // Configurable gRPC server address for agent connections
    // Allows agents to connect from anywhere (K8s, external servers, etc.)
    this.grpcServerAddress = this.configService.get<string>('GRPC_SERVER_ADDRESS', 'session-management-server:50051');

    this.kc = new k8s.KubeConfig();

    try {
      // Try to load in-cluster config first (for production)
      this.kc.loadFromCluster();
      this.logger.log('Loaded in-cluster Kubernetes config');
    } catch (e) {
      // Fall back to local config (for development)
      this.kc.loadFromDefault();
      this.logger.log('Loaded default Kubernetes config from ~/.kube/config');
    }

    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
  }

  /**
   * Get DNS configuration for production environment.
   * Agent pods use K8s internal DNS for service discovery (stt-service, tts-service).
   *
   * Configuration via .env.production:
   *   KUBERNETES_DNS_IP=10.43.0.10  (K8s CoreDNS IP for service discovery)
   *
   * Note: CUSTOM_DNS_SERVERS (8.8.8.8) is used by STT/TTS init containers for model downloads.
   *       Agent pods use K8s DNS because they need to resolve internal services.
   */
  private getProductionDnsConfig(): object {
    if (process.env.NODE_ENV !== 'production') {
      return {}; // Use default K8s DNS in non-production
    }

    // K8s CoreDNS IP - required for agent pods to resolve internal services
    // Configure via KUBERNETES_DNS_IP in .env.production
    // Find with: kubectl get svc -n kube-system kube-dns -o jsonpath='{.spec.clusterIP}'
    const k8sDnsIp = this.configService.get<string>('KUBERNETES_DNS_IP', '');

    if (!k8sDnsIp || k8sDnsIp.trim() === '') {
      this.logger.warn('KUBERNETES_DNS_IP not set in production - using default K8s DNS');
      return {}; // Fall back to default K8s DNS
    }

    this.logger.debug(`Using K8s DNS for agent pod: ${k8sDnsIp}`);

    return {
      dnsPolicy: 'None',
      dnsConfig: {
        nameservers: [k8sDnsIp],
        searches: [
          `${this.namespace}.svc.cluster.local`,
          'svc.cluster.local',
          'cluster.local',
          // Note: UZH's cloud.science-it.uzh.ch is intentionally excluded to avoid SSL interception
        ],
        options: [
          {
            name: 'ndots',
            value: '2', // Try absolute resolution for names with 2+ dots (like api.openai.com)
          },
        ],
      },
    };
  }

  async createAgentPod(config: AgentPodConfig): Promise<{ podName: string; secretName: string }> {
    const podName = `agent-${config.agentId}`;
    const secretName = `agent-secret-${config.agentId}`;

    // Determine agent type (default to stella-agent)
    const agentType = config.agentType || this.defaultAgentType;

    // Ensure agent image exists (builds on-demand if needed)
    this.logger.log(`Ensuring agent image exists for type: ${agentType}`);
    const agentImage = await this.agentImageService.ensureImageExists(agentType, config.forceRebuild);
    this.logger.log(`Using agent image: ${agentImage}`);

    // Create Secret first
    await this.createSecret(secretName, config);

    // Create Pod
    // Sanitize label values - K8s labels can only contain alphanumeric, '-', '_', '.'
    const sanitizeLabel = (value: string): string =>
      value.replace(/[^a-zA-Z0-9\-_.]/g, '-').replace(/^-+|-+$/g, '');

    const pod: k8s.V1Pod = {
      metadata: {
        name: podName,
        labels: {
          app: 'stella-ai-agent',
          agentId: config.agentId,
          sessionId: config.sessionId,
          projectId: config.projectId,
          agentName: sanitizeLabel(config.agentName),
          agentType: agentType,
        },
      },
      spec: {
        restartPolicy: 'Never',
        // Production-only: Override DNS to bypass corporate SSL inspection (UZH network)
        // Uses CUSTOM_DNS_SERVERS (e.g., 8.8.8.8) with K8s search domains for service discovery
        ...(this.getProductionDnsConfig()),
        // Pod-level security: run as non-root user
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 1000,
          fsGroup: 1000,
        },
        containers: [
          {
            name: 'agent',
            image: agentImage,
            imagePullPolicy: this.imagePullPolicy as any,
            // Container-level security: prevent privilege escalation, drop capabilities
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: {
                drop: ['ALL'],
              },
            },
            // Run agent module (config from environment variables)
            // echo-agent -> echo_agent, stella-agent -> stella_agent
            command: ['python', '-m', agentType.replace(/-/g, '_')],
            envFrom: [
              {
                secretRef: {
                  name: secretName,
                },
              },
            ],
            env: [
              // Agent identity for gRPC registration
              {
                name: 'AGENT_ID',
                value: config.agentId,
              },
              {
                name: 'SESSION_ID',
                value: config.sessionId,
              },
              {
                name: 'AGENT_NAME',
                value: config.agentName,
              },
              {
                name: 'AGENT_ICON',
                value: config.agentIcon,
              },
              {
                name: 'AGENT_TYPE',
                value: agentType,
              },
              // gRPC server address (configurable via GRPC_SERVER_ADDRESS env var)
              {
                name: 'GRPC_SERVER',
                value: this.grpcServerAddress,
              },
              // Agent identity for LiveKit room joining
              {
                name: 'AGENT_IDENTITY',
                value: `agent-${config.agentId}`,
              },
              // STT/TTS service addresses for direct agent communication
              {
                name: 'STT_SERVICE_ADDRESS',
                value: this.configService.get<string>('STT_SERVICE_ADDRESS', 'stt-service:50051'),
              },
              {
                name: 'TTS_SERVICE_ADDRESS',
                value: this.configService.get<string>('TTS_SERVICE_ADDRESS', 'tts-service:50052'),
              },
              // Environment mode (for conditional gateway IP setup)
              {
                name: 'NODE_ENV',
                value: process.env.NODE_ENV || 'local',
              },
              // API keys (OPENAI_API_KEY, ELEVENLABS_API_KEY, etc.) must be provided
              // via user's env var template - no default fallback
            ],
            resources: {
              requests: {
                memory: '512Mi',
                cpu: '250m',
                // Allocate GPU for production (Tesla T4) to enable GPU-accelerated TTS/STT
                ...(process.env.NODE_ENV === 'production' && {
                  'nvidia.com/gpu': '1',
                }),
              },
              limits: {
                memory: '2Gi',
                cpu: '1000m',
                // Limit GPU allocation to 1 GPU per pod in production
                ...(process.env.NODE_ENV === 'production' && {
                  'nvidia.com/gpu': '1',
                }),
              },
            },
          },
        ],
      },
    };

    try {
      await this.k8sApi.createNamespacedPod({ namespace: this.namespace, body: pod });
      this.logger.log(`Created pod ${podName} in namespace ${this.namespace}`);
      return { podName, secretName };
    } catch (error) {
      this.logger.error(`Failed to create pod: ${error.message}`);
      // Clean up secret if pod creation failed
      await this.deleteSecret(secretName).catch(() => {});
      throw error;
    }
  }

  private async createSecret(secretName: string, config: AgentPodConfig): Promise<void> {
    // Fetch custom env vars from template if specified
    let customEnvVars: Record<string, string> = {};
    if (config.envVarTemplateId && config.userId) {
      try {
        this.logger.log(`Fetching env var template ${config.envVarTemplateId} for user ${config.userId}`);
        customEnvVars = await this.envVarTemplatesService.getDecryptedVariables(
          config.envVarTemplateId,
          config.userId,
        );
        this.logger.log(`Loaded ${Object.keys(customEnvVars).length} custom environment variables`);
      } catch (error) {
        this.logger.error(`Failed to load env var template: ${error.message}`);
        throw error;
      }
    }

    const secret: k8s.V1Secret = {
      metadata: {
        name: secretName,
        labels: {
          agentId: config.agentId,
          sessionId: config.sessionId,
          projectId: config.projectId,
        },
      },
      type: 'Opaque',
      stringData: {
        // Agent-specific configuration
        LIVEKIT_URL: config.livekitUrl,
        LIVEKIT_API_KEY: config.livekitApiKey,
        LIVEKIT_API_SECRET: config.livekitApiSecret,
        ROOM_NAME: config.roomName,
        IDENTITY: `agent-${config.agentId}`,
        TTS_PROVIDER: config.ttsProvider,
        // API keys (OPENAI_API_KEY, ELEVENLABS_API_KEY, etc.) come from customEnvVars below
        // Agent-specific config as JSON string (each agent interprets as needed)
        // Frontend and agents now use canonical SDK format (no transformation needed)
        AGENT_CONFIG: JSON.stringify(config.agentConfig || {}),
        // Custom environment variables from user's env var template (decrypted)
        ...customEnvVars,
      },
    };

    try {
      await this.k8sApi.createNamespacedSecret({ namespace: this.namespace, body: secret });
      this.logger.log(`Created secret ${secretName} in namespace ${this.namespace}`);
    } catch (error) {
      this.logger.error(`Failed to create secret: ${error.message}`);
      throw error;
    }
  }

  async deletePod(podName: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedPod({
        name: podName,
        namespace: this.namespace,
        gracePeriodSeconds: 0  // Force immediate termination (SIGKILL)
      });
      this.logger.log(`Deleted pod ${podName} from namespace ${this.namespace}`);
    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.warn(`Pod ${podName} not found`);
      } else {
        this.logger.error(`Failed to delete pod: ${error.message}`);
        throw error;
      }
    }
  }

  async deleteSecret(secretName: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedSecret({ name: secretName, namespace: this.namespace });
      this.logger.log(`Deleted secret ${secretName} from namespace ${this.namespace}`);
    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.warn(`Secret ${secretName} not found`);
      } else {
        this.logger.error(`Failed to delete secret: ${error.message}`);
      }
    }
  }

  async deleteConfigMap(configMapName: string): Promise<void> {
    try {
      await this.k8sApi.deleteNamespacedConfigMap({ name: configMapName, namespace: this.namespace });
      this.logger.log(`Deleted configmap ${configMapName} from namespace ${this.namespace}`);
    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.warn(`ConfigMap ${configMapName} not found`);
      } else {
        this.logger.error(`Failed to delete configmap: ${error.message}`);
      }
    }
  }

  async getPodStatus(podName: string): Promise<any> {
    try {
      const response = await this.k8sApi.readNamespacedPod({ name: podName, namespace: this.namespace });
      return {
        phase: response.status?.phase,
        conditions: response.status?.conditions,
        containerStatuses: response.status?.containerStatuses,
      };
    } catch (error) {
      if (error.response?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async getPodLogs(podName: string): Promise<string> {
    try {
      const response = await this.k8sApi.readNamespacedPodLog({
        name: podName,
        namespace: this.namespace,
        tailLines: 100,
      });
      return typeof response === 'string' ? response : String(response);
    } catch (error) {
      if (error.response?.statusCode === 404) {
        return '';
      }
      throw error;
    }
  }

  async streamPodLogs(podName: string, callback: (chunk: string) => void, onError?: (error: Error) => void): Promise<() => void> {
    // Return a cleanup function to stop the stream
    let intervalId: NodeJS.Timeout | null = null;
    let lastLogLength = 0;

    try {
      // Poll for new logs every 2 seconds
      intervalId = setInterval(async () => {
        try {
          const response = await this.k8sApi.readNamespacedPodLog({
            name: podName,
            namespace: this.namespace,
            tailLines: 1000, // Get last 1000 lines for full log history
          });

          const logs = typeof response === 'string' ? response : String(response);

          // Only send new logs (compare by length to avoid sending duplicates)
          if (logs.length > lastLogLength) {
            callback(logs);
            lastLogLength = logs.length;
          }
        } catch (error) {
          if (error.response?.statusCode === 404) {
            // Pod not found, stop streaming
            if (intervalId) clearInterval(intervalId);
            if (onError) onError(new Error('Pod not found'));
          } else {
            this.logger.error(`Error streaming logs: ${error.message}`);
            if (onError) onError(error);
          }
        }
      }, 2000);

      // Return cleanup function
      return () => {
        if (intervalId) {
          clearInterval(intervalId);
          this.logger.log(`Stopped streaming logs for pod ${podName}`);
        }
      };
    } catch (error) {
      this.logger.error(`Failed to start log stream: ${error.message}`);
      throw error;
    }
  }
}

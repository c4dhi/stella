import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as k8s from '@kubernetes/client-node';

export interface AgentPodConfig {
  agentId: string;
  sessionId: string;
  projectId: string;
  agentName: string;
  agentIcon: string;
  roomName: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  // openaiApiKey removed - now read from grace-ai-secrets
  ttsProvider: string;
  planId?: string;
}

@Injectable()
export class KubernetesService {
  private readonly logger = new Logger(KubernetesService.name);
  private readonly kc: k8s.KubeConfig;
  private readonly k8sApi: k8s.CoreV1Api;
  private readonly namespace: string;
  private readonly agentImage: string;
  private readonly imagePullPolicy: string;

  constructor(private configService: ConfigService) {
    this.namespace = this.configService.get<string>('KUBERNETES_NAMESPACE', 'default');
    this.agentImage = this.configService.get<string>('AGENT_IMAGE', 'conversational-ai-server:latest');
    this.imagePullPolicy = this.configService.get<string>('AGENT_IMAGE_PULL_POLICY', 'IfNotPresent');

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

  async createAgentPod(config: AgentPodConfig): Promise<{ podName: string; secretName: string }> {
    const podName = `agent-${config.agentId}`;
    const secretName = `agent-secret-${config.agentId}`;

    // Create Secret first
    await this.createSecret(secretName, config);

    // Create Pod
    const pod: k8s.V1Pod = {
      metadata: {
        name: podName,
        labels: {
          app: 'conversational-ai-agent',
          agentId: config.agentId,
          sessionId: config.sessionId,
          projectId: config.projectId,
          agentName: config.agentName,
        },
      },
      spec: {
        restartPolicy: 'Never',
        // Automatically delete pods after they complete or fail (1 hour)
        // This prevents accumulation of stopped pods in the cluster
        activeDeadlineSeconds: 3600, // 1 hour maximum runtime
        containers: [
          {
            name: 'agent',
            image: this.agentImage,
            imagePullPolicy: this.imagePullPolicy as any,
            envFrom: [
              {
                secretRef: {
                  name: secretName,
                },
              },
            ],
            env: [
              // Agent identity
              {
                name: 'AGENT_NAME',
                value: config.agentName,
              },
              {
                name: 'AGENT_ICON',
                value: config.agentIcon,
              },
              // Shared API keys from central grace-ai-secrets
              {
                name: 'OPENAI_API_KEY',
                valueFrom: {
                  secretKeyRef: {
                    name: 'grace-ai-secrets',
                    key: 'openai-api-key',
                  },
                },
              },
              {
                name: 'ELEVENLABS_API_KEY',
                valueFrom: {
                  secretKeyRef: {
                    name: 'grace-ai-secrets',
                    key: 'elevenlabs-api-key',
                  },
                },
              },
            ],
            resources: {
              requests: {
                memory: '512Mi',
                cpu: '250m',
              },
              limits: {
                memory: '2Gi',
                cpu: '1000m',
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
        // OPENAI_API_KEY removed - now from grace-ai-secrets
        // ELEVENLABS_API_KEY removed - now from grace-ai-secrets
        ...(config.planId && { PLAN_ID: config.planId }),
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
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace: this.namespace });
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

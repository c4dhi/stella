import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec, ExecException } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { AgentTypeService, AgentTypeInfo as DbAgentTypeInfo } from '../agent-type/agent-type.service';

const execAsync = promisify(exec);

export interface AgentImageConfig {
  imageName: string;
  dockerfilePath: string;
  contextPath: string;
  tag: string;
}

// Extended type info for gallery display
export interface AgentTypeInfo {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string | null;
  version: string;
  isBuiltIn: boolean;
  capabilities: string[];
  defaultConfig: Record<string, unknown>;
  configSchema: Record<string, unknown> | null;  // JSON Schema for agent config (includes x-stella-* extensions)
}

@Injectable()
export class AgentImageService {
  private readonly logger = new Logger(AgentImageService.name);
  private readonly workspaceRoot: string;
  private readonly isProduction: boolean;  // Production uses K3s (needs containerd import)
  private readonly isRunningInK8s: boolean;
  private readonly hasDockerSocket: boolean;

  // Registry of known agent types and their build contexts
  // Paths are relative to stella-backend/ directory (the new context)
  private readonly agentRegistry: Map<string, AgentImageConfig> = new Map([
    ['stella-agent', {
      imageName: 'stella-agent',
      dockerfilePath: 'agents/stella-agent/Dockerfile',
      contextPath: '.',
      tag: 'latest',
    }],
    ['stella-light-agent', {
      imageName: 'stella-light-agent',
      dockerfilePath: 'agents/stella-light-agent/Dockerfile',
      contextPath: '.',
      tag: 'latest',
    }],
    ['echo-agent', {
      imageName: 'echo-agent',
      dockerfilePath: 'agents/echo-agent/Dockerfile',
      contextPath: '.',
      tag: 'latest',
    }],
  ]);

  // Track images currently being built to avoid duplicate builds
  private readonly buildingImages: Map<string, Promise<string>> = new Map();

  constructor(
    private configService: ConfigService,
    private agentTypeService: AgentTypeService,
  ) {
    // Detect if running inside a K8s pod
    this.isRunningInK8s = !!process.env.KUBERNETES_SERVICE_HOST;

    // Production (K3s) vs Local (OrbStack/Docker Desktop)
    // - Production: Uses K3s with containerd, needs image import after Docker build
    // - Local: Uses OrbStack/Docker Desktop with shared Docker daemon, no import needed
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'local');
    this.isProduction = nodeEnv === 'production';

    // In K8s, use the mounted workspace path from AGENT_WORKSPACE_ROOT env var
    // Otherwise, compute it relative to this file's location
    if (this.isRunningInK8s && process.env.AGENT_WORKSPACE_ROOT) {
      this.workspaceRoot = process.env.AGENT_WORKSPACE_ROOT;
    } else {
      // Local development: workspace root is stella-backend/ directory
      // (agents are now inside stella-backend/agents/)
      this.workspaceRoot = path.resolve(__dirname, '../../../');
    }

    // Check if Docker socket is available (either native or mounted in K8s)
    this.hasDockerSocket = this.checkDockerSocket();

    this.logger.log(`AgentImageService initialized`);
    this.logger.log(`Workspace root: ${this.workspaceRoot}`);
    this.logger.log(`Environment: ${nodeEnv} (${this.isProduction ? 'K3s/containerd' : 'OrbStack/Docker'})`);
    this.logger.log(`Running in K8s: ${this.isRunningInK8s}`);
    this.logger.log(`Docker socket available: ${this.hasDockerSocket}`);

    if (this.isRunningInK8s && !this.hasDockerSocket) {
      this.logger.warn(`Running inside K8s pod without Docker socket - images must be pre-built`);
    }
  }

  /**
   * Check if Docker is available for building images.
   * Runs synchronously at startup to test if Docker CLI works.
   */
  private checkDockerSocket(): boolean {
    const { execSync } = require('child_process');
    try {
      // Test if docker command is available and can connect
      execSync('docker version', { stdio: 'pipe', timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Register a new agent type for on-demand building.
   */
  registerAgentType(agentType: string, config: AgentImageConfig): void {
    this.agentRegistry.set(agentType, config);
    this.logger.log(`Registered agent type: ${agentType} -> ${config.imageName}:${config.tag}`);
  }

  /**
   * Get all registered agent types.
   */
  getRegisteredAgentTypes(): string[] {
    return Array.from(this.agentRegistry.keys());
  }

  /**
   * Get all registered agent types with metadata from database.
   * Throws error if database is not seeded - no fallback to prevent silent failures.
   */
  async getAgentTypesWithInfo(): Promise<AgentTypeInfo[]> {
    const dbTypes = await this.agentTypeService.getAgentTypesForGallery();

    if (dbTypes.length === 0) {
      this.logger.error('No agent types found in database. Database must be seeded.');
      throw new Error(
        'No agent types found. Please run: npx prisma db seed\n' +
        'This will read agent.yaml manifests from agents/ directory and populate the database.'
      );
    }

    this.logger.debug(`Loaded ${dbTypes.length} agent types from database`);
    return dbTypes;
  }

  /**
   * Ensure agent image exists, building if necessary.
   * Returns the full image name (e.g., "stella-agent:latest")
   *
   * When running inside K8s with Docker socket mounted, we can build images.
   * Without Docker socket, we assume images are pre-built on the host.
   *
   * This method is idempotent - if the image is already being built,
   * it will wait for that build to complete rather than starting a new one.
   */
  async ensureImageExists(agentType: string, forceRebuild = false): Promise<string> {
    const config = this.agentRegistry.get(agentType);
    if (!config) {
      throw new Error(`Unknown agent type: ${agentType}. Available types: ${this.getRegisteredAgentTypes().join(', ')}`);
    }

    const fullImageName = `${config.imageName}:${config.tag}`;

    // If no Docker socket available, we can't build - assume images are pre-built
    if (!this.hasDockerSocket) {
      this.logger.log(`No Docker socket available - assuming image ${fullImageName} is pre-built`);
      return fullImageName;
    }

    // If force rebuild, skip cache check
    if (!forceRebuild) {
      // Check if image exists
      if (await this.imageExists(fullImageName)) {
        this.logger.log(`Image ${fullImageName} already exists (cached)`);
        return fullImageName;
      }
    }

    // Check if this image is currently being built
    const existingBuild = this.buildingImages.get(fullImageName);
    if (existingBuild) {
      this.logger.log(`Image ${fullImageName} is already being built, waiting...`);
      return existingBuild;
    }

    // Build the image and return the image name when done
    const buildPromise = (async (): Promise<string> => {
      await this.buildAndImportImage(config, forceRebuild);
      return fullImageName;
    })();

    this.buildingImages.set(fullImageName, buildPromise);

    try {
      return await buildPromise;
    } finally {
      this.buildingImages.delete(fullImageName);
    }
  }

  /**
   * Check if Docker image exists locally.
   *
   * On macOS: Checks Docker daemon
   * On Linux (K3s): Checks Docker daemon only when running inside K8s pod
   *                 (k3s ctr requires sudo which pods don't have)
   *                 The deployment script's sync_images_to_k3s ensures containerd has the images.
   */
  private async imageExists(imageName: string): Promise<boolean> {
    try {
      // Check Docker daemon first
      const { stdout } = await execAsync(`docker images -q ${imageName}`);
      const existsInDocker = stdout.trim().length > 0;

      // When running inside K8s pod, we can't check K3s containerd (requires sudo)
      // Trust that the deployment script has synced images to K3s containerd
      if (this.isRunningInK8s) {
        this.logger.debug(`Running in K8s pod - checking Docker only (k3s ctr requires sudo)`);
        return existsInDocker;
      }

      // On Linux with K3s (running outside of K8s, e.g., direct CLI), check containerd too
      if (this.isProduction) {
        const existsInK3s = await this.imageExistsInK3s(imageName);
        // Return true only if image exists in BOTH Docker and K3s
        // (if it's in Docker but not K3s, we need to import it)
        return existsInDocker && existsInK3s;
      }

      return existsInDocker;
    } catch (error) {
      this.logger.warn(`Error checking image existence: ${error.message}`);
      return false;
    }
  }

  /**
   * Build Docker image using Docker CLI.
   *
   * Platform behavior:
   * - macOS (OrbStack/Docker Desktop): Images built via Docker socket are automatically
   *   available to the Kubernetes cluster (no import needed)
   * - Linux (K3s): Images must be imported into K3s containerd after building
   */
  private async buildAndImportImage(config: AgentImageConfig, forceRebuild: boolean): Promise<void> {
    const fullImageName = `${config.imageName}:${config.tag}`;
    const dockerfilePath = path.join(this.workspaceRoot, config.dockerfilePath);
    const contextPath = path.join(this.workspaceRoot, config.contextPath);
    const noCacheFlag = forceRebuild ? '--no-cache' : '';

    this.logger.log(`Building image ${fullImageName}...`);
    this.logger.log(`  Dockerfile: ${dockerfilePath}`);
    this.logger.log(`  Context: ${contextPath}`);
    this.logger.log(`  Workspace root: ${this.workspaceRoot}`);
    this.logger.log(`  Environment: ${this.isProduction ? 'Production (K3s)' : 'Local (OrbStack/Docker)'}`);
    if (forceRebuild) {
      this.logger.log(`  Force rebuild: enabled (--no-cache)`);
    }

    const startTime = Date.now();

    try {
      // Build with Docker
      const buildCmd = `docker build ${noCacheFlag} -t ${fullImageName} -f ${dockerfilePath} ${contextPath}`;
      this.logger.log(`Executing: ${buildCmd}`);

      const { stdout, stderr } = await execAsync(buildCmd, {
        timeout: 600000, // 10 min timeout for builds
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for build output
      });

      if (stderr && !stderr.includes('Successfully')) {
        this.logger.debug(`Build stderr: ${stderr}`);
      }

      const buildTime = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Image ${fullImageName} built successfully in ${buildTime}s`);

      // On Linux with K3s, we need to import the image into containerd
      // On macOS with OrbStack/Docker Desktop, images are automatically available
      if (this.isProduction) {
        await this.importToK3s(fullImageName);
      }
    } catch (error) {
      const execError = error as ExecException & { stdout?: string; stderr?: string };
      this.logger.error(`Failed to build image ${fullImageName}: ${execError.message}`);
      if (execError.stderr) {
        this.logger.error(`Build stderr: ${execError.stderr}`);
      }
      throw error;
    }
  }

  /**
   * Import a Docker image into K3s containerd (Linux only).
   *
   * K3s uses containerd as its container runtime, so images built with Docker
   * need to be exported and imported into containerd.
   */
  private async importToK3s(imageName: string): Promise<void> {
    this.logger.log(`Importing ${imageName} into K3s containerd...`);

    try {
      // Export from Docker to tar file
      const tarPath = `/tmp/${imageName.replace(':', '-').replace('/', '-')}.tar`;
      this.logger.log(`Exporting image to ${tarPath}...`);
      await execAsync(`docker save ${imageName} -o ${tarPath}`, { timeout: 120000 });

      // Import into K3s containerd
      // Note: When running inside K3s pod with hostPID and proper mounts, we can use ctr directly
      // The k3s ctr command wraps containerd's ctr with the right socket path
      this.logger.log(`Importing into K3s containerd...`);
      try {
        // Try without sudo first (works if container has proper permissions)
        await execAsync(`k3s ctr images import ${tarPath}`, { timeout: 120000 });
      } catch {
        // Fall back to sudo if needed
        await execAsync(`sudo k3s ctr images import ${tarPath}`, { timeout: 120000 });
      }

      // Clean up tar file
      await execAsync(`rm -f ${tarPath}`);

      this.logger.log(`Successfully imported ${imageName} into K3s containerd`);
    } catch (error) {
      this.logger.error(`Failed to import image into K3s: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if image exists in K3s containerd.
   */
  private async imageExistsInK3s(imageName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`k3s ctr images ls -q | grep -E "^docker.io/library/${imageName}$"`, {
        timeout: 10000,
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Force rebuild an agent image.
   */
  async rebuildImage(agentType: string): Promise<string> {
    return this.ensureImageExists(agentType, true);
  }

  /**
   * Remove an agent image from local cache.
   */
  async removeImage(agentType: string): Promise<void> {
    const config = this.agentRegistry.get(agentType);
    if (!config) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }

    const fullImageName = `${config.imageName}:${config.tag}`;
    this.logger.log(`Removing image ${fullImageName}...`);

    try {
      if (this.isProduction) {
        // Remove from K3s containerd
        try {
          await execAsync(`k3s ctr images rm docker.io/library/${fullImageName}`);
        } catch {
          await execAsync(`sudo k3s ctr images rm docker.io/library/${fullImageName}`);
        }
      }
      // Remove from Docker
      await execAsync(`docker rmi ${fullImageName}`);
      this.logger.log(`Removed image ${fullImageName}`);
    } catch (error) {
      this.logger.warn(`Error removing image: ${error.message}`);
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';

const execAsync = promisify(exec);

export interface ServerMetrics {
  timestamp: string;
  // Node.js server metrics
  cpuUsage: number; // Percentage 0-100
  cpuCores: number;
  memoryTotal: bigint;
  memoryUsed: bigint;
  memoryFree: bigint;
  // GPU metrics (auto-detected via nvidia-smi)
  gpuUsage: number | null;
  gpuMemoryUsed: bigint | null;
  gpuMemoryTotal: bigint | null;
  gpuAvailable: boolean;
  // Kubernetes cluster metrics (if available)
  k8sNodeCount: number | null;
  k8sPodCount: number | null;
  k8sCpuRequests: number | null;
  k8sMemoryUsed: bigint | null;
}

interface CpuTimes {
  idle: number;
  total: number;
}

/**
 * ServerMetricsService - Collects server performance metrics
 *
 * Gathers metrics from multiple sources:
 * - Node.js os module for CPU/RAM
 * - nvidia-smi for GPU (auto-detected, graceful fallback)
 * - Kubernetes API for cluster stats (optional)
 */
@Injectable()
export class ServerMetricsService implements OnModuleInit {
  private readonly logger = new Logger(ServerMetricsService.name);
  private gpuAvailable = false;
  private lastCpuTimes: CpuTimes | null = null;

  async onModuleInit() {
    // Detect GPU availability at startup
    this.gpuAvailable = await this.detectGpu();
    this.logger.log(`GPU detection: ${this.gpuAvailable ? 'NVIDIA GPU available' : 'No GPU detected'}`);
  }

  /**
   * Detect if nvidia-smi is available
   */
  private async detectGpu(): Promise<boolean> {
    try {
      await execAsync('nvidia-smi --query-gpu=name --format=csv,noheader');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get CPU usage percentage
   * Uses delta between two measurements for accuracy
   */
  private getCpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      idle += cpu.times.idle;
      total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
    }

    if (this.lastCpuTimes) {
      const idleDiff = idle - this.lastCpuTimes.idle;
      const totalDiff = total - this.lastCpuTimes.total;
      const usage = totalDiff > 0 ? ((totalDiff - idleDiff) / totalDiff) * 100 : 0;
      this.lastCpuTimes = { idle, total };
      return Math.round(usage * 10) / 10; // Round to 1 decimal
    }

    this.lastCpuTimes = { idle, total };
    return 0; // First call returns 0, subsequent calls will have accurate delta
  }

  /**
   * Get GPU metrics via nvidia-smi
   */
  private async getGpuMetrics(): Promise<{
    usage: number | null;
    memoryUsed: bigint | null;
    memoryTotal: bigint | null;
  }> {
    if (!this.gpuAvailable) {
      return { usage: null, memoryUsed: null, memoryTotal: null };
    }

    try {
      const { stdout } = await execAsync(
        'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
      );

      const lines = stdout.trim().split('\n');
      if (lines.length > 0) {
        const [usage, memUsed, memTotal] = lines[0].split(',').map((s) => s.trim());
        return {
          usage: parseFloat(usage),
          memoryUsed: BigInt(parseInt(memUsed) * 1024 * 1024), // Convert MiB to bytes
          memoryTotal: BigInt(parseInt(memTotal) * 1024 * 1024),
        };
      }
    } catch (error) {
      this.logger.warn('Failed to get GPU metrics:', error);
    }

    return { usage: null, memoryUsed: null, memoryTotal: null };
  }

  /**
   * Get Kubernetes cluster metrics
   * Requires access to K8s API
   */
  private async getK8sMetrics(): Promise<{
    nodeCount: number | null;
    podCount: number | null;
    cpuRequests: number | null;
    memoryUsed: bigint | null;
  }> {
    // K8s metrics would be implemented by injecting KubernetesService
    // and calling the K8s API. For now, return null values.
    // This can be enhanced when K8s metrics API is available.
    return {
      nodeCount: null,
      podCount: null,
      cpuRequests: null,
      memoryUsed: null,
    };
  }

  /**
   * Collect all server metrics
   */
  async collectMetrics(): Promise<ServerMetrics> {
    const [gpuMetrics, k8sMetrics] = await Promise.all([
      this.getGpuMetrics(),
      this.getK8sMetrics(),
    ]);

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
      timestamp: new Date().toISOString(),
      cpuUsage: this.getCpuUsage(),
      cpuCores: os.cpus().length,
      memoryTotal: BigInt(totalMem),
      memoryUsed: BigInt(usedMem),
      memoryFree: BigInt(freeMem),
      gpuUsage: gpuMetrics.usage,
      gpuMemoryUsed: gpuMetrics.memoryUsed,
      gpuMemoryTotal: gpuMetrics.memoryTotal,
      gpuAvailable: this.gpuAvailable,
      k8sNodeCount: k8sMetrics.nodeCount,
      k8sPodCount: k8sMetrics.podCount,
      k8sCpuRequests: k8sMetrics.cpuRequests,
      k8sMemoryUsed: k8sMetrics.memoryUsed,
    };
  }

  /**
   * Check if GPU is available
   */
  isGpuAvailable(): boolean {
    return this.gpuAvailable;
  }
}

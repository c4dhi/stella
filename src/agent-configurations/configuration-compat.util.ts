import { createHash } from 'crypto';

/**
 * Pure compatibility helpers for AgentConfiguration overrides against an
 * AgentType's pipelineSchema.
 *
 * These are intentionally DI-free so they can be shared by:
 *  - AgentConfigurationsService (NestJS runtime), and
 *  - prisma/seed.ts (plain node script, no Nest container).
 */

export type PipelineSchema = Record<string, unknown> | null | undefined;

/** Sparse override payload: { nodes?: {...}, thresholds?: {...} } */
export type ConfigOverrides = Record<string, unknown>;

/**
 * Validate an override payload against a pipelineSchema. Throws an Error whose
 * message explains the first incompatibility found:
 *  - a node override referencing an unknown node id, or
 *  - a threshold override that is unknown or outside its declared min/max range.
 *
 * Callers map the thrown Error to the appropriate transport (HTTP 400 in the
 * service, OUTDATED status in the reconciler).
 */
export function validateConfigurationAgainstSchema(
  config: ConfigOverrides,
  pipelineSchema: PipelineSchema,
): void {
  if (!pipelineSchema) return;

  const nodes = pipelineSchema.nodes as
    | Array<Record<string, unknown>>
    | undefined;
  const thresholds = pipelineSchema.thresholds as
    | Array<Record<string, unknown>>
    | undefined;

  // Validate node overrides reference known node ids.
  const configNodes = config.nodes as Record<string, unknown> | undefined;
  if (configNodes && nodes) {
    const knownNodeIds = new Set(nodes.map((n) => n.id as string));
    for (const nodeId of Object.keys(configNodes)) {
      if (!knownNodeIds.has(nodeId)) {
        throw new Error(`Unknown node ID in configuration: ${nodeId}`);
      }
    }
  }

  // Validate threshold overrides are known and within range.
  const configThresholds = config.thresholds as
    | Record<string, unknown>
    | undefined;
  if (configThresholds && thresholds) {
    const thresholdMap = new Map(thresholds.map((t) => [t.id as string, t]));
    for (const [key, value] of Object.entries(configThresholds)) {
      const schema = thresholdMap.get(key);
      if (!schema) {
        throw new Error(`Unknown threshold in configuration: ${key}`);
      }
      if (typeof value === 'number') {
        const min = schema.min as number | undefined;
        const max = schema.max as number | undefined;
        if (min !== undefined && value < min) {
          throw new Error(
            `Threshold ${key} value ${value} is below minimum ${min}`,
          );
        }
        if (max !== undefined && value > max) {
          throw new Error(
            `Threshold ${key} value ${value} is above maximum ${max}`,
          );
        }
      }
    }
  }
}

/**
 * Conservatively prune overrides that reference nodes/thresholds which no longer
 * exist in the schema. This is the only auto-mutation the reconciler performs:
 * it drops dangling references (a node/threshold the new schema removed) but
 * never clamps or rewrites values the user explicitly set. Out-of-range values
 * are left intact so re-validation flags them as OUTDATED for user review.
 *
 * Returns the (possibly) pruned overrides plus the list of removed keys.
 */
export function pruneRemovedOverrides(
  config: ConfigOverrides,
  pipelineSchema: PipelineSchema,
): { sanitized: ConfigOverrides; prunedKeys: string[] } {
  if (!pipelineSchema) return { sanitized: config, prunedKeys: [] };

  const prunedKeys: string[] = [];
  const result: ConfigOverrides = { ...config };

  const nodes = pipelineSchema.nodes as
    | Array<Record<string, unknown>>
    | undefined;
  const thresholds = pipelineSchema.thresholds as
    | Array<Record<string, unknown>>
    | undefined;

  const configNodes = config.nodes as Record<string, unknown> | undefined;
  if (configNodes && nodes) {
    const knownNodeIds = new Set(nodes.map((n) => n.id as string));
    const kept: Record<string, unknown> = {};
    for (const [nodeId, value] of Object.entries(configNodes)) {
      if (knownNodeIds.has(nodeId)) kept[nodeId] = value;
      else prunedKeys.push(`nodes.${nodeId}`);
    }
    result.nodes = kept;
  }

  const configThresholds = config.thresholds as
    | Record<string, unknown>
    | undefined;
  if (configThresholds && thresholds) {
    const knownThresholdIds = new Set(thresholds.map((t) => t.id as string));
    const kept: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(configThresholds)) {
      if (knownThresholdIds.has(key)) kept[key] = value;
      else prunedKeys.push(`thresholds.${key}`);
    }
    result.thresholds = kept;
  }

  return { sanitized: result, prunedKeys };
}

/**
 * Compare two dotted version strings numerically (e.g. "1.2.0" vs "1.10.0").
 * Non-numeric segments compare lexically and sort after numeric ones. Returns
 * negative if a < b, 0 if equal, positive if a > b.
 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? '0';
    const sb = pb[i] ?? '0';
    const na = Number(sa);
    const nb = Number(sb);
    const aNum = Number.isInteger(na);
    const bNum = Number.isInteger(nb);
    if (aNum && bNum) {
      if (na !== nb) return na - nb;
    } else if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Whether an available compiler version satisfies a configuration's required
 * minimum. No requirement (falsy) is always satisfied. If a minimum is required
 * but the agent declares no compiler version, it cannot be guaranteed → not
 * satisfied.
 */
export function satisfiesMinCompilerVersion(
  available: string | null | undefined,
  required: string | null | undefined,
): boolean {
  if (!required) return true;
  if (!available) return false;
  return compareVersions(available, required) >= 0;
}

/**
 * Stable SHA-256 of a pipelineSchema, used by the seed to detect schema edits
 * (even when the manifest version string didn't change) so reconciliation runs
 * only when the schema actually changed.
 */
export function hashPipelineSchema(pipelineSchema: PipelineSchema): string {
  const canonical = canonicalJsonStringify(pipelineSchema ?? null);
  return createHash('sha256').update(canonical).digest('hex');
}

/** Deterministic JSON stringify with sorted object keys. */
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`)
    .join(',')}}`;
}

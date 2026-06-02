import * as fs from 'fs';
import * as path from 'path';
import { parseAgentManifestYaml } from './agent-manifest.schema';

/**
 * Guards the stella-light-agent manifest after it was made configurable (ticket #240
 * follow-up): it must declare a valid pipelineSchema so the Agent Configurator offers
 * it and saved configurations validate/reconcile like stella-v2.
 */
describe('stella-light-agent manifest', () => {
  const manifestPath = path.resolve(
    __dirname,
    '../../../agents/stella-light-agent/agent.yaml',
  );
  const result = parseAgentManifestYaml(fs.readFileSync(manifestPath, 'utf8'));

  it('parses successfully against the strict schema', () => {
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('declares a configurable pipelineSchema with the response node', () => {
    const schema = result.manifest?.pipelineSchema as
      | { nodes: Array<{ id: string; slots: Array<{ id: string }> }>; thresholds: Array<{ id: string }> }
      | undefined;
    expect(schema).toBeDefined();

    const response = schema!.nodes.find((n) => n.id === 'response');
    expect(response).toBeDefined();
    const slotIds = response!.slots.map((s) => s.id);
    expect(slotIds).toEqual(
      expect.arrayContaining(['persona', 'conversation_guidelines', 'model', 'temperature', 'max_tokens']),
    );

    expect(schema!.thresholds.map((t) => t.id)).toContain('history_limit');
  });

  it('marks the config schema as configurator-enabled', () => {
    const configSchema = result.manifest?.configSchema as Record<string, unknown> | undefined;
    expect(configSchema?.['x-stella-supports-configurator']).toBe(true);
  });
});

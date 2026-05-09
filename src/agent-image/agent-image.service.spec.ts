import { ConfigService } from '@nestjs/config';
import * as childProcess from 'child_process';

import { AgentImageService } from './agent-image.service';
import { AgentTypeService } from '../agent-type/agent-type.service';

jest.mock('child_process');

describe('AgentImageService.checkContainerdHealth', () => {
  const agentTypeService = {} as AgentTypeService;
  const originalK8sEnv = process.env.KUBERNETES_SERVICE_HOST;

  function makeService(env: Record<string, string | undefined>): AgentImageService {
    const config = new ConfigService();
    jest.spyOn(config, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
      return env[key] ?? defaultValue;
    });
    return new AgentImageService(config, agentTypeService);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // execSync is called by the constructor's checkDockerSocket(); make it succeed by default.
    (childProcess.execSync as jest.Mock).mockReturnValue(Buffer.from(''));
  });

  afterEach(() => {
    if (originalK8sEnv === undefined) {
      delete process.env.KUBERNETES_SERVICE_HOST;
    } else {
      process.env.KUBERNETES_SERVICE_HOST = originalK8sEnv;
    }
  });

  it('returns ok when CONTAINER_RUNTIME is not k3s (local dev)', async () => {
    delete process.env.KUBERNETES_SERVICE_HOST;
    const svc = makeService({ NODE_ENV: 'local' });

    await expect(svc.checkContainerdHealth()).resolves.toEqual({ ok: true });
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  it('returns ok when CONTAINER_RUNTIME=none even if NODE_ENV=production', async () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    const svc = makeService({ NODE_ENV: 'production', CONTAINER_RUNTIME: 'none' });

    await expect(svc.checkContainerdHealth()).resolves.toEqual({ ok: true });
    expect(childProcess.exec).not.toHaveBeenCalled();
  });

  it('returns ok when k3s ctr version succeeds', async () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    (childProcess.exec as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(null, 'Client version', '');
      },
    );
    const svc = makeService({ NODE_ENV: 'production', CONTAINER_RUNTIME: 'k3s' });

    await expect(svc.checkContainerdHealth()).resolves.toEqual({ ok: true });
    expect(childProcess.exec).toHaveBeenCalledWith(
      'k3s ctr version',
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it('returns ok=false with error when k3s ctr version fails', async () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.0.0.1';
    (childProcess.exec as unknown as jest.Mock).mockImplementation(
      (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('connect: connection refused'), '', '');
      },
    );
    const svc = makeService({ NODE_ENV: 'production', CONTAINER_RUNTIME: 'k3s' });

    await expect(svc.checkContainerdHealth()).resolves.toEqual({
      ok: false,
      error: 'connect: connection refused',
    });
  });
});

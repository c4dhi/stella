import { ConfigService } from '@nestjs/config';
import { TtsService } from './tts.service';
import * as client from './grpc/tts-capabilities.client';
import { TtsCapabilities } from './grpc/tts-capabilities.client';

describe('TtsService', () => {
  const caps: TtsCapabilities = {
    provider: 'qwen3',
    voices: [{ id: 'stella', displayName: 'Stella', languages: ['en', 'de'], defaultLanguage: 'en' }],
    languages: ['en', 'de', 'fr'],
    defaultVoice: 'stella',
    supportsVoiceSelection: false,
  };

  const makeService = () => {
    const config = { get: jest.fn().mockReturnValue('tts-service:50052') } as unknown as ConfigService;
    return new TtsService(config);
  };

  afterEach(() => jest.restoreAllMocks());

  it('fetches capabilities from the gRPC client', async () => {
    const spy = jest.spyOn(client, 'fetchTtsCapabilities').mockResolvedValue(caps);
    const service = makeService();

    await expect(service.getCapabilities()).resolves.toEqual(caps);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches the result and does not refetch within the TTL', async () => {
    const spy = jest.spyOn(client, 'fetchTtsCapabilities').mockResolvedValue(caps);
    const service = makeService();

    await service.getCapabilities();
    await service.getCapabilities();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent fetches into a single in-flight call', async () => {
    const spy = jest.spyOn(client, 'fetchTtsCapabilities').mockResolvedValue(caps);
    const service = makeService();

    const [a, b] = await Promise.all([service.getCapabilities(), service.getCapabilities()]);

    expect(a).toEqual(caps);
    expect(b).toEqual(caps);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns a safe empty catalog when the tts-service is unreachable', async () => {
    jest.spyOn(client, 'fetchTtsCapabilities').mockRejectedValue(new Error('unreachable'));
    const service = makeService();

    const result = await service.getCapabilities();

    expect(result.voices).toEqual([]);
    expect(result.supportsVoiceSelection).toBe(false);
    expect(result.provider).toBe('unavailable');
  });
});

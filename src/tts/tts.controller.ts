import { Controller, Get, Header } from '@nestjs/common';
import { TtsService } from './tts.service';
import { TtsCapabilities } from './grpc/tts-capabilities.client';

@Controller('tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  /**
   * Voices and languages the active TTS provider can synthesize. Consumed by
   * the deploy UI so an agent is only offered provider-valid choices.
   * Authenticated via the global JwtAuthGuard (no @Public).
   */
  @Get('capabilities')
  @Header('Cache-Control', 'private, max-age=30')
  async getCapabilities(): Promise<TtsCapabilities> {
    return this.tts.getCapabilities();
  }
}

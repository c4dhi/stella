import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { LiveKitService } from '../livekit/livekit.service'
import { MediaTestSession } from './dto/media-test.dto'

const TOKEN_TTL_SECONDS = 90
const PER_IP_COOLDOWN_MS = 30_000

@Injectable()
export class MediaTestService {
  private readonly logger = new Logger(MediaTestService.name)
  private readonly recentByIp: Map<string, number> = new Map()

  constructor(private readonly livekit: LiveKitService) {}

  async start(clientIp: string | undefined): Promise<MediaTestSession> {
    this.gcRecent()
    const ip = clientIp || 'unknown'
    const last = this.recentByIp.get(ip)
    if (last && Date.now() - last < PER_IP_COOLDOWN_MS) {
      const retryIn = Math.ceil((PER_IP_COOLDOWN_MS - (Date.now() - last)) / 1000)
      throw new HttpException(
        { message: `Please wait ${retryIn}s before running another media test.` },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    this.recentByIp.set(ip, Date.now())

    const roomName = `health-media-test-${randomUUID()}`
    const identity = `readiness-${randomUUID().slice(0, 8)}`
    const token = await this.livekit.createToken(
      roomName,
      identity,
      'Readiness check',
      `${TOKEN_TTL_SECONDS}s`,
    )
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000)
    expiresAt.setMilliseconds(0)

    return {
      roomName,
      token,
      livekitUrl: this.livekit.getPublicServerUrl(),
      expiresAt: expiresAt.toISOString(),
      ttlSeconds: TOKEN_TTL_SECONDS,
    }
  }

  private gcRecent() {
    const cutoff = Date.now() - PER_IP_COOLDOWN_MS * 4
    for (const [ip, t] of this.recentByIp) {
      if (t < cutoff) this.recentByIp.delete(ip)
    }
  }
}

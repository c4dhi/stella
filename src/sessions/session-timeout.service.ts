import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';

/**
 * WIP — issue #198: Auto-end sessions after inactivity or a max-duration hard cap.
 *
 * Two independent timers per active session:
 *  - inactivityTimer:  fires `sessionInactivityEndMinutes` after last participant activity
 *  - maxDurationTimer: fires `sessionMaxDurationMinutes` after session createdAt
 *
 * Both close the session via SessionsService.close().
 *
 * NOTE: In-memory timers do not survive restarts; a reconcile loop is scheduled on startup
 * to re-arm timers for active sessions. Distributed deployments will need a persisted
 * scheduler (out of scope for this WIP).
 */
@Injectable()
export class SessionTimeoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionTimeoutService.name);

  private readonly inactivityTimers = new Map<string, NodeJS.Timeout>();
  private readonly maxDurationTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileActiveSessions();
  }

  onModuleDestroy(): void {
    for (const timer of this.inactivityTimers.values()) clearTimeout(timer);
    for (const timer of this.maxDurationTimers.values()) clearTimeout(timer);
    this.inactivityTimers.clear();
    this.maxDurationTimers.clear();
  }

  /** Re-arm timers for sessions that were ACTIVE before the process restarted. */
  private async reconcileActiveSessions(): Promise<void> {
    const sessions = await this.prisma.session.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        createdAt: true,
        sessionInactivityEndMinutes: true,
        sessionMaxDurationMinutes: true,
      },
    });

    for (const session of sessions) {
      if (session.sessionMaxDurationMinutes) {
        const elapsedMs = Date.now() - session.createdAt.getTime();
        const remainingMs = session.sessionMaxDurationMinutes * 60_000 - elapsedMs;
        this.armMaxDurationTimer(session.id, Math.max(0, remainingMs));
      }
      // Inactivity timer is not re-armed here — it will be started on the next
      // participant-activity event. TODO: persist lastActivityAt on Session
      // so this can be reconciled accurately.
    }
    this.logger.log(`Reconciled auto-end timers for ${sessions.length} active session(s)`);
  }

  /**
   * Called when a session is created/started. Arms the hard-cap timer.
   * Inactivity timer will start on the first participant event.
   */
  onSessionStarted(sessionId: string, maxDurationMinutes: number | null): void {
    if (maxDurationMinutes) {
      this.armMaxDurationTimer(sessionId, maxDurationMinutes * 60_000);
    }
  }

  /**
   * Called on any participant activity (message, audio, interaction).
   * Resets the inactivity timer.
   *
   * TODO: Wire this up to message/audio events (LiveKit webhook + message
   * recorder). Not called from anywhere yet — inactivity auto-end is
   * non-functional until this is invoked.
   */
  onSessionActivity(sessionId: string): void {
    void this.resetInactivityTimer(sessionId);
  }

  onSessionClosed(sessionId: string): void {
    this.clearTimers(sessionId);
  }

  private async resetInactivityTimer(sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, sessionInactivityEndMinutes: true },
    });
    if (!session || session.status !== 'ACTIVE' || !session.sessionInactivityEndMinutes) return;

    this.clearInactivityTimer(sessionId);
    const delayMs = session.sessionInactivityEndMinutes * 60_000;
    const timer = setTimeout(() => this.endSession(sessionId, 'inactivity'), delayMs);
    this.inactivityTimers.set(sessionId, timer);
  }

  private armMaxDurationTimer(sessionId: string, delayMs: number): void {
    this.clearMaxDurationTimer(sessionId);
    const timer = setTimeout(() => this.endSession(sessionId, 'max_duration'), delayMs);
    this.maxDurationTimers.set(sessionId, timer);
  }

  private async endSession(sessionId: string, reason: 'inactivity' | 'max_duration'): Promise<void> {
    this.clearTimers(sessionId);
    try {
      this.logger.log(`Auto-ending session ${sessionId} (reason: ${reason})`);
      await this.sessionsService.close(sessionId);
    } catch (error) {
      this.logger.error(`Failed to auto-end session ${sessionId}: ${(error as Error).message}`);
    }
  }

  private clearInactivityTimer(sessionId: string): void {
    const existing = this.inactivityTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.inactivityTimers.delete(sessionId);
    }
  }

  private clearMaxDurationTimer(sessionId: string): void {
    const existing = this.maxDurationTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.maxDurationTimers.delete(sessionId);
    }
  }

  private clearTimers(sessionId: string): void {
    this.clearInactivityTimer(sessionId);
    this.clearMaxDurationTimer(sessionId);
  }
}

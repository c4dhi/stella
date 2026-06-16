import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { SessionsService } from './sessions.service';

/**
 * Issue #198 — backend-authoritative **max-duration cap**.
 *
 * This enforces the *one* timeout that closes a session: a hard cap measured from
 * the **first agent message** (the same anchor the participant-facing countdown
 * uses). Inactivity is deliberately NOT handled here — inactivity pauses agents via
 * the existing empty-room pause path (`agentInactivityTimeoutMinutes`) and never
 * closes a session. The only terminal triggers are: plan finish, this cap, and a
 * manual close.
 *
 * One in-memory timer per active session. `maxDurationTimers.has(sessionId)` doubles
 * as the "already armed" guard so repeated agent-message events are cheap (no DB).
 * Timers don't survive a restart, so `onModuleInit` reconciles active sessions from
 * the persisted `firstAgentMessageAt` anchor.
 */
@Injectable()
export class SessionTimeoutService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionTimeoutService.name);
  private readonly maxDurationTimers = new Map<string, NodeJS.Timeout>();

  /**
   * Safety-net sweep cadence. The in-memory timers are armed immediately by the
   * `session.agent-message` event (the fast path), but events are fragile — a
   * refactor once silently stopped emitting it and auto-end broke entirely. This
   * sweep makes the cap self-healing: it reconciles ACTIVE sessions from PERSISTED
   * state (the session cap + recorded messages), so a missed event delays the close
   * by at most one interval instead of disabling it. Never depend on a single signal.
   */
  private static readonly SWEEP_INTERVAL_MS = 30_000;
  private sweepTimer: NodeJS.Timeout | null = null;

  /**
   * How far past a session's expected close time it may linger in CLOSING before the
   * sweep force-finalizes it. The graceful-close force-close backstop lives in an
   * in-memory timer; a process restart mid-close loses it, which could otherwise
   * strand the session in CLOSING. This margin is well beyond the agent's wrap-up
   * window, so the sweep only ever acts on a genuinely stuck close, never a live one.
   */
  private static readonly STUCK_CLOSING_MARGIN_MS = 120_000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcile();
    this.sweepTimer = setInterval(
      () => void this.reconcile(),
      SessionTimeoutService.SWEEP_INTERVAL_MS,
    );
    // Don't keep the process alive just for the sweep.
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const timer of this.maxDurationTimers.values()) clearTimeout(timer);
    this.maxDurationTimers.clear();
  }

  /**
   * Defense-in-depth reconciliation (issue #198). For every ACTIVE session with a
   * cap that isn't already tracked by an in-memory timer:
   *   1. derive the first-agent-message anchor from persisted messages if the event
   *      never set it (so a missed `session.agent-message` can't disable the cap),
   *   2. arm the timer — `armCapTimer` fires immediately if the cap already elapsed.
   * Runs on boot (re-arm after a restart) and on every sweep. Idempotent: sessions
   * already armed are skipped, closed sessions drop out of the ACTIVE filter.
   */
  private async reconcile(): Promise<void> {
    let sessions: Array<{
      id: string;
      status: string;
      maxSessionDurationSeconds: number | null;
      firstAgentMessageAt: Date | null;
    }>;
    try {
      sessions = await this.prisma.session.findMany({
        where: {
          status: { in: ['ACTIVE', 'CLOSING'] },
          maxSessionDurationSeconds: { not: null },
        },
        select: {
          id: true,
          status: true,
          maxSessionDurationSeconds: true,
          firstAgentMessageAt: true,
        },
      });
    } catch (error) {
      this.logger.error(`Cap reconciliation sweep failed: ${(error as Error).message}`);
      return;
    }

    let armed = 0;
    for (const s of sessions) {
      // A session stranded in CLOSING (force-close timer lost to a restart) is
      // finalized once it's well past its expected close time.
      if (s.status === 'CLOSING') {
        await this.finalizeIfStuckClosing(s);
        continue;
      }

      if (this.maxDurationTimers.has(s.id)) continue; // already tracked

      let anchor = s.firstAgentMessageAt;
      if (!anchor) {
        anchor = await this.deriveAnchorFromMessages(s.id);
        if (!anchor) continue; // agent hasn't spoken yet — nothing to anchor on
      }
      this.armCapTimer(s.id, s.maxSessionDurationSeconds!, anchor);
      armed++;
    }
    if (armed > 0) {
      this.logger.log(`Cap reconciliation: armed ${armed} session(s) from persisted state`);
    }
  }

  /**
   * Force-finalize a session stuck in CLOSING past its expected close time (its
   * in-memory force-close backstop was lost, e.g. to a restart). Conservative: only
   * acts well beyond the agent's wrap-up window, and close() is idempotent so racing
   * a live close is harmless.
   */
  private async finalizeIfStuckClosing(s: {
    id: string;
    maxSessionDurationSeconds: number | null;
    firstAgentMessageAt: Date | null;
  }): Promise<void> {
    if (!s.firstAgentMessageAt || !s.maxSessionDurationSeconds) return;
    const expectedClosedBy =
      s.firstAgentMessageAt.getTime() +
      s.maxSessionDurationSeconds * 1000 +
      SessionTimeoutService.STUCK_CLOSING_MARGIN_MS;
    if (Date.now() < expectedClosedBy) return; // still within the close window

    this.logger.warn(
      `Session ${s.id} stuck in CLOSING past its grace window — force-finalizing`,
    );
    try {
      await this.sessionsService.close(s.id);
    } catch (error) {
      this.logger.error(
        `Failed to finalize stuck CLOSING session ${s.id}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Recover the cap anchor straight from the message log when the in-flight event
   * was missed: the timestamp of the earliest spoken agent message. Persists it so
   * the anchor survives restarts and matches the participant-facing countdown.
   */
  private async deriveAnchorFromMessages(sessionId: string): Promise<Date | null> {
    const firstAgentMessage = await this.prisma.message.findFirst({
      where: {
        sessionId,
        role: 'assistant',
        messageType: { in: ['transcript', 'transcript_chunk', 'agent_text'] },
      },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    });
    if (!firstAgentMessage) return null;

    const anchor = firstAgentMessage.timestamp;
    await this.prisma.session.updateMany({
      where: { id: sessionId, firstAgentMessageAt: null },
      data: { firstAgentMessageAt: anchor },
    });
    this.logger.warn(
      `Session ${sessionId}: recovered cap anchor from message log (missed agent-message event)`,
    );
    return anchor;
  }

  /**
   * Arm the cap on the first agent message. Emitted by the message recorder for any
   * agent ("assistant") message; the in-memory guard makes every call after the
   * first a no-op, so this stays cheap.
   */
  @OnEvent('session.agent-message')
  async onAgentMessage(payload: { sessionId: string }): Promise<void> {
    const { sessionId } = payload;
    if (this.maxDurationTimers.has(sessionId)) return; // already armed

    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { status: true, maxSessionDurationSeconds: true, firstAgentMessageAt: true },
    });
    if (!session || session.status !== 'ACTIVE' || !session.maxSessionDurationSeconds) return;

    // Stamp the anchor exactly once (guarded), so a restart can reconcile accurately.
    let anchor = session.firstAgentMessageAt;
    if (!anchor) {
      anchor = new Date();
      await this.prisma.session.updateMany({
        where: { id: sessionId, firstAgentMessageAt: null },
        data: { firstAgentMessageAt: anchor },
      });
    }

    this.armCapTimer(sessionId, session.maxSessionDurationSeconds, anchor);
  }

  /** Stop tracking a session once it is closed (or deleted). */
  @OnEvent('session.lifecycle.closed')
  onSessionClosed(payload: { sessionId: string }): void {
    this.clear(payload.sessionId);
  }

  private armCapTimer(sessionId: string, capSeconds: number, anchor: Date): void {
    this.clear(sessionId);
    const elapsedMs = Date.now() - anchor.getTime();
    const remainingMs = Math.max(0, capSeconds * 1000 - elapsedMs);
    const timer = setTimeout(() => void this.fire(sessionId), remainingMs);
    this.maxDurationTimers.set(sessionId, timer);
    this.logger.log(
      `Armed max-duration cap for session ${sessionId}: ${Math.round(remainingMs / 1000)}s remaining (cap ${capSeconds}s)`,
    );
  }

  private async fire(sessionId: string): Promise<void> {
    this.clear(sessionId);
    this.logger.log(`Max-duration cap reached for session ${sessionId} — graceful close`);
    try {
      // Graceful close (issue #198): drive CLOSING → fire a "session_end" interrupt →
      // give the agent a bounded grace window to speak a wrap-up turn → then finalize
      // (force-close at the deadline). The agent never gets cut off mid-sentence.
      await this.sessionsService.beginGracefulClose(sessionId, 'session_end');
    } catch (error) {
      this.logger.error(
        `Failed to auto-close session ${sessionId} on max-duration cap: ${(error as Error).message}`,
      );
    }
  }

  /** Clear and forget a session's cap timer. Public for tests and direct callers. */
  clear(sessionId: string): void {
    const existing = this.maxDurationTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
      this.maxDurationTimers.delete(sessionId);
    }
  }
}

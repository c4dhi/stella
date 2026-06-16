-- Session auto-end (issue #198): backend-authoritative max-duration cap.
-- Inactivity continues to be handled by the agent pause path and never closes a
-- session; this adds only the hard max-duration cap (measured from the first agent
-- message) that SessionTimeoutService enforces by closing the session.
--
-- The cap is opt-in per session: it is set from the invitation (manual invite) or
-- the public-session config (publicMaxSessionDurationSeconds) when a participant is
-- invited. There is no project-wide default applied to every session.

-- Effective cap on the session (null = no cap), plus the anchor timestamp (set on
-- the first agent message) the cap timer measures from.
ALTER TABLE "Session" ADD COLUMN "maxSessionDurationSeconds" INTEGER;
ALTER TABLE "Session" ADD COLUMN "firstAgentMessageAt" TIMESTAMP(3);

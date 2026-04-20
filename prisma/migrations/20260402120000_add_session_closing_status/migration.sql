-- Add transitional session status to avoid marking sessions fully closed
-- before the agent has finished farewell and disconnected.
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'CLOSING';

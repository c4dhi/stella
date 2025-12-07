import { useCallback } from 'react'
import { generateUUID } from '../../../lib/uuid'
import type { TranscriptChunk, DeliveryStatus } from '../../../lib/types'

interface UseMessagingOptions {
  /** User name for message attribution */
  userName?: string
}

interface UseMessagingReturn {
  /**
   * Creates an optimistic TranscriptChunk for immediate display.
   * The chunk will have status='final', deliveryStatus='sending', and a unique correlationId.
   */
  createOptimisticMessage: (text: string) => TranscriptChunk

  /**
   * Determines the display delivery status for a message.
   * - Pending text messages: 'sending' (grey checkmarks)
   * - Confirmed text messages: 'confirmed' (solid checkmarks)
   * - Final speech transcripts: 'confirmed' (agent received audio)
   * - Partial messages: undefined (no checkmarks)
   */
  getDeliveryStatus: (
    message: TranscriptChunk,
    pendingCorrelationIds?: Set<string>
  ) => DeliveryStatus | undefined
}

/**
 * Hook for shared messaging functionality between session and participant screens.
 * Provides utilities for creating optimistic messages and determining delivery status.
 */
export function useMessaging({ userName }: UseMessagingOptions = {}): UseMessagingReturn {
  const createOptimisticMessage = useCallback(
    (text: string): TranscriptChunk => {
      const now = Date.now()
      const correlationId = generateUUID()

      return {
        id: generateUUID(),
        role: 'user',
        text,
        status: 'final',
        startedAt: now,
        finalizedAt: now,
        source: 'user_text',
        speaker_name: userName,
        correlationId,
        deliveryStatus: 'sending',
      }
    },
    [userName]
  )

  const getDeliveryStatus = useCallback(
    (
      message: TranscriptChunk,
      pendingCorrelationIds?: Set<string>
    ): DeliveryStatus | undefined => {
      // Only user messages can have delivery status
      if (message.role !== 'user') {
        return undefined
      }

      // Partial messages don't show delivery status
      if (message.status === 'partial') {
        return undefined
      }

      // Check if message has explicit delivery status
      if (message.deliveryStatus) {
        return message.deliveryStatus
      }

      // Check if message is pending confirmation via correlationId
      if (message.correlationId && pendingCorrelationIds?.has(message.correlationId)) {
        return 'sending'
      }

      // Final speech transcripts are inherently confirmed (agent received audio)
      if (message.source === 'user_speech' && message.status === 'final') {
        return 'confirmed'
      }

      // Final text messages without explicit status - assume confirmed if no pending set
      if (message.source === 'user_text' && message.status === 'final') {
        // If we have a pending set and this message isn't in it, it's confirmed
        if (pendingCorrelationIds && !pendingCorrelationIds.has(message.correlationId || '')) {
          return 'confirmed'
        }
        // Default to sending if we can't determine
        return message.deliveryStatus || 'confirmed'
      }

      return undefined
    },
    []
  )

  return {
    createOptimisticMessage,
    getDeliveryStatus,
  }
}

export default useMessaging

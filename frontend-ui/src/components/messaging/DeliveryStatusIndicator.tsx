import { motion } from 'framer-motion'
import type { DeliveryStatus } from '../../lib/types'

interface DeliveryStatusIndicatorProps {
  status: DeliveryStatus
  className?: string
}

/**
 * WhatsApp-style double checkmark indicator for message delivery status.
 * - 'sending': Two greyed out checkmarks (message sent, awaiting confirmation)
 * - 'confirmed': Two solid checkmarks (agent has echoed the message)
 */
export default function DeliveryStatusIndicator({
  status,
  className = '',
}: DeliveryStatusIndicatorProps) {
  const isConfirmed = status === 'confirmed'

  return (
    <motion.div
      className={`inline-flex items-center ${className}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
    >
      {/* Double checkmark SVG - two overlapping checks */}
      <svg
        width="16"
        height="11"
        viewBox="0 0 16 11"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`transition-opacity duration-300 ${
          isConfirmed ? 'opacity-100' : 'opacity-40'
        }`}
      >
        {/* First checkmark */}
        <path
          d="M1 5.5L4.5 9L11 2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Second checkmark (offset to the right) */}
        <path
          d="M5 5.5L8.5 9L15 2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  )
}

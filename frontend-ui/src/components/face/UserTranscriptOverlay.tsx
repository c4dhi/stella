/**
 * User Transcript Overlay
 * Displays real-time partial transcription of user speech underneath the GRACE face
 * Only visible during active speech, disappears when transcript is finalized
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface UserTranscriptOverlayProps {
  transcript: string;
  isVisible: boolean;
}

const UserTranscriptOverlay: React.FC<UserTranscriptOverlayProps> = ({
  transcript,
  isVisible
}) => {
  return (
    <AnimatePresence>
      {isVisible && transcript && (
        <motion.div
          className="absolute bottom-24 left-1/2 -translate-x-1/2 max-w-2xl px-6 py-3 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl text-white/90 text-lg font-light text-center shadow-2xl"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.98 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {transcript}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default UserTranscriptOverlay;

/**
 * GRACE Face Modal
 * Full-screen black overlay with animated GRACE face
 */

import React, { useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import GraceFace from './GraceFace';
import UserTranscriptOverlay from './UserTranscriptOverlay';
import { X } from 'lucide-react';
import { useStore } from '../../store';
import { startMicWithVu } from '../../services/audio/capture';

interface GraceFaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  isUserSpeaking?: boolean;
  isRemoteSpeaking?: boolean;
  audioLevel?: number;
}

const GraceFaceModal: React.FC<GraceFaceModalProps> = ({
  isOpen,
  onClose,
  isUserSpeaking = false,
  isRemoteSpeaking = false,
  audioLevel = 0
}) => {
  // Store state for mute button
  const status = useStore(s => s.status);
  const transport = useStore(s => s.transport);
  const isMuted = useStore(s => s.isMuted);
  const isRecording = useStore(s => s.isRecording);
  const setIsMuted = useStore(s => s.setIsMuted);
  const setIsRecording = useStore(s => s.setIsRecording);

  // Store state for user transcript (partial only)
  const userPartialTranscript = useStore(s =>
    s.turns.find(t => t.role === 'user' && t.status === 'partial')?.text || ''
  );

  // Refs for audio management
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Toggle mute function (synced with Composer)
  const toggleMute = useCallback(async () => {
    if (!transport || status !== 'connected') return;

    if (isMuted) {
      // Unmute - start streaming audio
      try {
        // Clean up any existing stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        let audioContext = audioContextRef.current;
        if (!audioContext) {
          audioContext = new AudioContext();
          audioContextRef.current = audioContext;
        }

        // Get microphone stream with VU meter
        const stream = await startMicWithVu(audioContext, transport as any);
        streamRef.current = stream;

        // Publish audio track to LiveKit
        await transport.publishAudioTrack(stream);

        setIsMuted(false);
        setIsRecording(true);
      } catch (error) {
        console.error('Error starting audio streaming:', error);
        setIsMuted(true);
        setIsRecording(false);
      }
    } else {
      // Mute - stop streaming audio
      await transport.unpublishAudioTrack();

      // Stop and clean up stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      setIsMuted(true);
      setIsRecording(false);
      useStore.getState().setVu(0); // Reset VU meter
    }
  }, [isMuted, transport, status, setIsMuted, setIsRecording]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      const cleanup = async () => {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        if (transport) {
          await transport.unpublishAudioTrack();
        }

        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }
        useStore.getState().setVu(0);
      };

      cleanup();
    };
  }, [transport]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: '#000000' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Close Button */}
          <motion.button
            className="absolute top-4 right-4 z-10 p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
            onClick={onClose}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 }}
            aria-label="Close face view"
          >
            <X className="w-6 h-6 text-white" />
          </motion.button>

          {/* GRACE Face */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <GraceFace
              isUserSpeaking={isUserSpeaking}
              isRemoteSpeaking={isRemoteSpeaking}
              audioLevel={audioLevel}
              eyeEmotion="listening"
              mouthEmotion={isRemoteSpeaking ? 'speaking' : 'smile'}
            />
          </motion.div>

          {/* User Transcript Overlay */}
          <UserTranscriptOverlay
            transcript={userPartialTranscript}
            isVisible={!!userPartialTranscript}
          />

          {/* Tracking Method Indicator (bottom left, subtle) */}
          <motion.div
            className="absolute bottom-4 left-4 text-white/40 text-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            Press ESC to close
          </motion.div>

          {/* Mute Button (bottom right) */}
          <motion.button
            onClick={toggleMute}
            disabled={status !== 'connected'}
            className={`absolute bottom-4 right-4 w-12 h-12 flex justify-center items-center p-3 rounded-full transition-all duration-300 ${
              status !== 'connected'
                ? 'bg-white/10 text-white/40 cursor-not-allowed'
                : isMuted
                  ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-400/40'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-400/40'
            }`}
            title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <motion.div
              animate={isRecording ? { scale: [1, 1.1, 1] } : { scale: 1 }}
              transition={{ duration: 1, repeat: isRecording ? Infinity : 0 }}
            >
              {isMuted ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28C16.28 17.23 19 14.41 19 11h-1.7z" />
                </svg>
              )}
            </motion.div>
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default GraceFaceModal;

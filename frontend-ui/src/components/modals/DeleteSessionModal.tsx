import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'

interface DeleteSessionModalProps {
  isOpen: boolean
  sessionName: string
  onConfirm: () => void
  onCancel: () => void
}

export default function DeleteSessionModal({
  isOpen,
  sessionName,
  onConfirm,
  onCancel,
}: DeleteSessionModalProps) {
  const [inputValue, setInputValue] = useState('')
  const isValid = inputValue === sessionName

  const handleConfirm = () => {
    if (isValid) {
      onConfirm()
      setInputValue('') // Reset for next time
    }
  }

  const handleCancel = () => {
    setInputValue('') // Reset input
    onCancel()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          onClick={handleCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="
              bg-white/95 backdrop-blur-xl border border-red-200/60
              rounded-[20px] shadow-[0_1px_40px_rgba(220,38,38,0.3)]
              w-full max-w-md p-6
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <h2 className="text-xl font-light text-neutral-900 tracking-wide mb-2">
              Delete Session
            </h2>

            {/* Warning Message */}
            <div className="mb-4 text-sm text-red-600 font-light leading-relaxed bg-red-50 p-3 rounded-lg border border-red-200">
              <div className="flex items-start gap-2">
                <span className="text-base">⚠️</span>
                <div className="flex-1">
                  <div className="font-medium mb-1">This will permanently delete:</div>
                  <ul className="mt-2 space-y-1 ml-4 list-disc">
                    <li>All messages and conversation history</li>
                    <li>All participants</li>
                    <li>All agents and their containers</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Confirmation Input */}
            <div className="mb-6">
              <label className="block text-sm text-neutral-600 font-light mb-2">
                Type <span className="font-mono font-medium text-neutral-900">{sessionName}</span> to confirm:
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={sessionName}
                className="
                  w-full px-3 py-2 rounded-lg
                  border border-neutral-200
                  text-neutral-900
                  placeholder:text-neutral-400
                  focus:border-red-400 focus:ring-2 focus:ring-red-100
                  outline-none transition-all
                  text-sm
                "
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="
                  flex-1 py-2.5 px-4 rounded-xl
                  bg-neutral-100/80 text-neutral-600 text-sm font-light tracking-wider
                  hover:bg-neutral-200/80
                  transition-all duration-200
                "
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={!isValid}
                className={`
                  flex-1 py-2.5 px-4 rounded-xl
                  text-white text-sm font-light tracking-wider
                  transition-all duration-200
                  ${
                    isValid
                      ? 'bg-red-600 hover:bg-red-700 shadow-[0_1px_20px_rgba(220,38,38,0.2)] cursor-pointer'
                      : 'bg-red-300 cursor-not-allowed'
                  }
                `}
              >
                Delete Session
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

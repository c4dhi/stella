import { motion, AnimatePresence } from 'framer-motion'

interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  confirmVariant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmButtonClasses =
    confirmVariant === 'danger'
      ? `
          flex-1 py-2.5 px-4 rounded-xl
          bg-red-600 text-white text-sm font-light tracking-wider
          hover:bg-red-700
          shadow-[0_1px_20px_rgba(220,38,38,0.2)]
          transition-all duration-200
        `
      : `
          flex-1 py-2.5 px-4 rounded-xl
          bg-neutral-900 text-white text-sm font-light tracking-wider
          hover:bg-neutral-800
          shadow-[0_1px_20px_rgba(0,0,0,0.12)]
          transition-all duration-200
        `

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/20 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="
              bg-white/95 backdrop-blur-xl border border-neutral-200/60
              rounded-[20px] shadow-[0_1px_40px_rgba(0,0,0,0.12)]
              w-full max-w-md p-6
            "
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4">
              <h2 className="text-xl font-light text-neutral-900 tracking-wide">
                {title}
              </h2>
            </div>

            {/* Message */}
            <div className="mb-6 text-sm text-neutral-600 font-light leading-relaxed">
              {message}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="
                  flex-1 py-2.5 px-4 rounded-xl
                  bg-neutral-100/80 text-neutral-600 text-sm font-light tracking-wider
                  hover:bg-neutral-200/80
                  transition-all duration-200
                "
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={confirmButtonClasses}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

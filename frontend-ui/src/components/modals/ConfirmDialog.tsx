import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'

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
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const getConfirmButtonClasses = () => {
    if (confirmVariant === 'danger') {
      return isDark
        ? 'flex-1 py-2.5 px-4 rounded-xl bg-red-600 text-white text-sm font-light tracking-wider hover:bg-red-700 transition-all duration-200'
        : 'flex-1 py-2.5 px-4 rounded-xl bg-red-600 text-white text-sm font-light tracking-wider hover:bg-red-700 shadow-[0_1px_20px_rgba(220,38,38,0.2)] transition-all duration-200'
    }
    return isDark
      ? 'flex-1 py-2.5 px-4 rounded-xl bg-white/10 text-white text-sm font-light tracking-wider hover:bg-white/20 border border-white/10 transition-all duration-200'
      : 'flex-1 py-2.5 px-4 rounded-xl bg-neutral-900 text-white text-sm font-light tracking-wider hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)] transition-all duration-200'
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={onCancel}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={`
              backdrop-blur-xl rounded-[20px] w-full max-w-md p-6
              ${isDark
                ? 'bg-zinc-800 border border-zinc-700 shadow-[0_8px_40px_rgba(0,0,0,0.5)]'
                : 'bg-white border border-neutral-200 shadow-[0_1px_40px_rgba(0,0,0,0.12)]'
              }
            `}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-4">
              <h2 className={`text-xl font-light tracking-wide ${isDark ? 'text-zinc-100' : 'text-neutral-900'}`}>
                {title}
              </h2>
            </div>

            {/* Message */}
            <div className={`mb-6 text-sm font-light leading-relaxed ${isDark ? 'text-zinc-400' : 'text-neutral-600'}`}>
              {message}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onCancel}
                className={`
                  flex-1 py-2.5 px-4 rounded-xl text-sm font-light tracking-wider transition-all duration-200
                  ${isDark
                    ? 'bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                  }
                `}
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={getConfirmButtonClasses()}
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

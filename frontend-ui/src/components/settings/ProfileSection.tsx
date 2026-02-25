import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1
    }
  }
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.46, 0.45, 0.94] as const
    }
  }
}

export default function ProfileSection() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  const handleSignOut = () => {
    logout()
    navigate('/login')
  }

  const displayName = user?.name || 'No name set'
  const initials = (user?.name || user?.email || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
    : 'Unknown'

  return (
    <motion.div
      className="max-w-2xl"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      <motion.h2
        className={`text-heading-lg mb-6 ${isDark ? 'text-content-inverse' : 'text-content'
          }`}
        variants={itemVariants}
      >
        Profile
      </motion.h2>

      {/* Avatar Section */}
      <motion.div
        className={`p-6 rounded-2xl mb-6 ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
          }`}
        variants={itemVariants}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      >
        <div className="flex items-center gap-6">
          <motion.div
            className={`w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-semibold ${isDark
              ? 'bg-gradient-to-br from-primary/30 to-primary/10 text-primary'
              : 'bg-gradient-to-br from-primary/20 to-primary/5 text-primary'
              }`}
            transition={{ type: 'spring', stiffness: 300, damping: 15 }}
          >
            {initials}
          </motion.div>

          <div>
            <h3
              className={`text-heading font-semibold ${isDark ? 'text-content-inverse' : 'text-content'
                }`}
            >
              {displayName}
            </h3>
            <p
              className={`text-body-sm mt-1 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}
            >
              {user?.email}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Account Details */}
      <motion.div
        className={`p-6 rounded-2xl overflow-hidden ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
          }`}
        variants={itemVariants}
      >
        <h3 className={`text-heading-sm font-semibold mb-4 ${isDark ? 'text-content-inverse' : 'text-content'
          }`}>
          Account Details
        </h3>

        <div className="space-y-0">
          {[
            { label: 'Email', value: user?.email },
            { label: 'Name', value: user?.name || 'Not set' },
            { label: 'Member since', value: memberSince },
            {
              label: 'Account Status',
              value: user?.verified ? 'Verified' : 'Pending',
              isBadge: true,
              isVerified: user?.verified
            }
          ].map((item, index) => (
            <div
              key={item.label}
              className={`flex justify-between items-center py-4 ${index !== 3 ? `border-b ${isDark ? 'border-border-dark/50' : 'border-border/50'}` : ''
                }`}
            >
              <span className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}>
                {item.label}
              </span>
              {item.isBadge ? (
                <motion.span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-medium ${item.isVerified
                    ? isDark
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-green-50 text-green-600'
                    : isDark
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-yellow-50 text-yellow-600'
                    }`}
                >
                  {item.isVerified && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                  {item.value}
                </motion.span>
              ) : (
                <span className={`text-body-sm font-medium ${isDark ? 'text-content-inverse' : 'text-content'
                  }`}>
                  {item.value}
                </span>
              )}
            </div>
          ))}
        </div>
      </motion.div>

      {/* Sign Out Section */}
      <motion.div
        className={`p-6 rounded-2xl mt-6 ${isDark ? 'bg-surface-dark-secondary' : 'bg-white border border-neutral-200/60'
          }`}
        variants={itemVariants}
      >
        <h3 className={`text-heading-sm font-semibold mb-2 ${isDark ? 'text-content-inverse' : 'text-content'
          }`}>
          Sign Out
        </h3>
        <p className={`text-body-sm mb-4 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
          }`}>
          End your current session and return to the login screen.
        </p>
        <motion.button
          onClick={handleSignOut}
          className={`px-4 py-2 rounded-lg text-body-sm font-medium transition-colors ${isDark
            ? 'bg-surface-dark-tertiary text-content-inverse hover:bg-red-500/20 hover:text-red-400'
            : 'bg-surface-tertiary text-content hover:bg-red-50 hover:text-red-600'
            }`}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          Sign out
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

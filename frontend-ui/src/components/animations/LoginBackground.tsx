// Simple background for login page - no animation

import { motion } from 'framer-motion'

export default function LoginBackground() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.5 }}
      className="fixed inset-0 -z-10 bg-neutral-50"
    />
  )
}

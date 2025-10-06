// Interactive background animation for login page
// Theme: Conversational AI - flowing particles forming speech patterns

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  opacity: number
  phase: number
  speed: number
}

export default function LoginBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const mouseRef = useRef({ x: 0, y: 0 })
  const animationFrameRef = useRef<number>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const updateCanvasSize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    updateCanvasSize()
    window.addEventListener('resize', updateCanvasSize)

    // Initialize particles
    const particleCount = 60
    particlesRef.current = Array.from({ length: particleCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.3 + 0.1,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.02 + 0.01,
    }))

    // Mouse move handler
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)

    // Animation loop
    const animate = () => {
      if (!canvas || !ctx) return

      // Clear canvas with fade effect
      ctx.fillStyle = 'rgba(250, 250, 250, 0.1)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      const particles = particlesRef.current
      const mouse = mouseRef.current

      particles.forEach((particle, i) => {
        // Update phase for wave motion
        particle.phase += particle.speed

        // Calculate wave offset
        const waveX = Math.sin(particle.phase) * 20
        const waveY = Math.cos(particle.phase * 0.7) * 15

        // Mouse interaction - subtle attraction
        const dx = mouse.x - particle.x
        const dy = mouse.y - particle.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const maxDist = 150

        if (dist < maxDist) {
          const force = (1 - dist / maxDist) * 0.02
          particle.vx += (dx / dist) * force
          particle.vy += (dy / dist) * force
        }

        // Apply velocity with wave
        particle.x += particle.vx + waveX * 0.01
        particle.y += particle.vy + waveY * 0.01

        // Damping
        particle.vx *= 0.98
        particle.vy *= 0.98

        // Boundary wrapping
        if (particle.x < 0) particle.x = canvas.width
        if (particle.x > canvas.width) particle.x = 0
        if (particle.y < 0) particle.y = canvas.height
        if (particle.y > canvas.height) particle.y = 0

        // Draw particle
        ctx.beginPath()
        ctx.arc(
          particle.x + waveX,
          particle.y + waveY,
          particle.size,
          0,
          Math.PI * 2
        )
        ctx.fillStyle = `rgba(0, 0, 0, ${particle.opacity})`
        ctx.fill()

        // Draw connections (speech bubble effect)
        particles.slice(i + 1).forEach(other => {
          const dx = other.x - particle.x
          const dy = other.y - particle.y
          const distance = Math.sqrt(dx * dx + dy * dy)

          if (distance < 120) {
            const opacity = (1 - distance / 120) * 0.08
            ctx.beginPath()
            ctx.moveTo(particle.x + waveX, particle.y + waveY)
            ctx.lineTo(
              other.x + Math.sin(other.phase) * 20,
              other.y + Math.cos(other.phase * 0.7) * 15
            )
            ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        })
      })

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    // Cleanup
    return () => {
      window.removeEventListener('resize', updateCanvasSize)
      window.removeEventListener('mousemove', handleMouseMove)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1.5 }}
      className="fixed inset-0 -z-10 bg-neutral-50"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ opacity: 0.4 }}
      />
      {/* Gradient overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-neutral-50/50 to-neutral-100/30" />
    </motion.div>
  )
}

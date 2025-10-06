import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { apiClient } from '../services/ApiClient'
import { useAuthStore } from '../store/authStore'
import { useToastStore } from '../store/toastStore'
import CreateProjectModal from '../components/modals/CreateProjectModal'
import EditProjectModal from '../components/modals/EditProjectModal'
import NetworkInfoModal from '../components/modals/NetworkInfoModal'
import type { ProjectWithCounts } from '../lib/api-types'

export default function ProjectsDashboard() {
  const navigate = useNavigate()
  const { logout, user } = useAuthStore()
  const { addToast } = useToastStore()

  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithCounts | null>(null)
  const [isNetworkInfoOpen, setIsNetworkInfoOpen] = useState(false)

  // Load projects
  const loadProjects = async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await apiClient.listProjects()
      setProjects(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadProjects()
  }, [])

  // Handle project creation
  const handleCreateProject = async (name: string) => {
    const newProject = await apiClient.createProject({ name })
    setProjects(prev => [newProject as ProjectWithCounts, ...prev])
    addToast({ message: `Project "${name}" created successfully`, type: 'success' })
  }

  // Handle project update
  const handleUpdateProject = async (name: string) => {
    if (!editingProject) return

    try {
      const updatedProject = await apiClient.updateProject(editingProject.id, { name })
      setProjects(prev =>
        prev.map(p => (p.id === editingProject.id ? { ...p, name: updatedProject.name } : p))
      )
      addToast({ message: `Project renamed to "${name}"`, type: 'success' })
    } catch (err) {
      throw err // Let modal handle the error
    }
  }

  // Handle project deletion
  const handleDeleteProject = async (projectId: string, projectName: string) => {
    if (!confirm(`Are you sure you want to delete "${projectName}"?`)) {
      return
    }

    try {
      await apiClient.deleteProject(projectId)
      setProjects(prev => prev.filter(p => p.id !== projectId))
      addToast({ message: `Project "${projectName}" deleted`, type: 'success' })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete project',
        type: 'error'
      })
    }
  }

  // Handle logout
  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-neutral-200/60 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-light text-neutral-900 tracking-wide">
              Grace AI
            </h1>
            <p className="text-xs text-neutral-500 font-light tracking-wide">
              {user?.name || user?.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsNetworkInfoOpen(true)}
              className="
                p-2 rounded-lg text-xs font-light tracking-wider
                text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80
                transition-all duration-200
              "
              title="Network Information"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </button>
            <button
              onClick={handleLogout}
              className="
                px-4 py-2 rounded-lg text-xs font-light tracking-wider
                text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100/80
                transition-all duration-200
              "
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Page Title */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <h2 className="text-3xl font-thin text-neutral-900 tracking-wider mb-2">
            Projects
          </h2>
          <p className="text-sm text-neutral-500 font-light">
            Manage your AI session projects
          </p>
        </motion.div>

        {/* Create Button */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
        >
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="
              px-5 py-2.5 rounded-xl
              bg-neutral-900 text-white text-sm font-light tracking-wider
              hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
              transition-all duration-200
              flex items-center gap-2
            "
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Project
          </button>
        </motion.div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-neutral-400 font-light">
              Loading projects...
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-6 rounded-xl bg-red-50/80 border border-red-200/60 text-red-600 text-sm font-light"
          >
            {error}
          </motion.div>
        )}

        {/* Empty State */}
        {!isLoading && !error && projects.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="text-6xl mb-4">💬</div>
            <h3 className="text-xl font-light text-neutral-900 mb-2">
              No projects yet
            </h3>
            <p className="text-sm text-neutral-500 font-light mb-6">
              Create your first project to get started
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="
                px-5 py-2.5 rounded-xl
                bg-neutral-900 text-white text-sm font-light tracking-wider
                hover:bg-neutral-800 shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                transition-all duration-200
              "
            >
              Create Project
            </button>
          </motion.div>
        )}

        {/* Projects Grid */}
        {!isLoading && !error && projects.length > 0 && (
          <motion.div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            initial="hidden"
            animate="visible"
            variants={{
              visible: {
                transition: {
                  staggerChildren: 0.05,
                },
              },
            }}
          >
            {projects.map((project) => (
              <motion.div
                key={project.id}
                variants={{
                  hidden: { opacity: 0, y: 20 },
                  visible: { opacity: 1, y: 0 },
                }}
                className="
                  bg-white/90 backdrop-blur-xl border border-neutral-200/60
                  rounded-[16px] shadow-[0_1px_20px_rgba(0,0,0,0.04)]
                  p-6 cursor-pointer
                  hover:shadow-[0_1px_30px_rgba(0,0,0,0.08)]
                  hover:border-neutral-300/60
                  transition-all duration-300
                  group
                "
                onClick={() => navigate(`/project/${project.id}`)}
                whileHover={{ y: -2 }}
              >
                {/* Project Name */}
                <h3 className="text-lg font-light text-neutral-900 mb-3 tracking-wide">
                  {project.name}
                </h3>

                {/* Stats */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500 font-light">
                      Active Sessions
                    </span>
                    <span className="text-neutral-900 font-normal">
                      {project.activeSessions}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500 font-light">
                      Active Agents
                    </span>
                    <span className="text-neutral-900 font-normal">
                      {project.activeAgents}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-neutral-500 font-light">
                      Total Sessions
                    </span>
                    <span className="text-neutral-900 font-normal">
                      {project.totalSessions}
                    </span>
                  </div>
                </div>

                {/* Created Date */}
                <div className="text-[10px] text-neutral-400 font-light tracking-wider uppercase mb-4">
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-neutral-200/60">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/project/${project.id}`)
                    }}
                    className="
                      flex-1 py-2 px-3 rounded-lg text-xs font-light tracking-wider
                      bg-neutral-900 text-white
                      hover:bg-neutral-800
                      transition-all duration-200
                    "
                  >
                    View Sessions
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingProject(project)
                    }}
                    className="
                      py-2 px-3 rounded-lg text-xs font-light
                      text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50/80
                      transition-all duration-200
                    "
                    title="Edit project"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteProject(project.id, project.name)
                    }}
                    className="
                      py-2 px-3 rounded-lg text-xs font-light
                      text-neutral-400 hover:text-red-600 hover:bg-red-50/80
                      transition-all duration-200
                    "
                    title="Delete project"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </main>

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateProject}
      />

      {/* Edit Project Modal */}
      {editingProject && (
        <EditProjectModal
          isOpen={!!editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleUpdateProject}
          currentName={editingProject.name}
          projectId={editingProject.id}
        />
      )}

      {/* Network Info Modal */}
      <NetworkInfoModal
        isOpen={isNetworkInfoOpen}
        onClose={() => setIsNetworkInfoOpen(false)}
      />
    </div>
  )
}

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { apiClient } from '../services/ApiClient'
import { useThemeStore } from '../store/themeStore'
import { useToastStore } from '../store/toastStore'
import CreateProjectModal from '../components/modals/CreateProjectModal'
import EditProjectModal from '../components/modals/EditProjectModal'
import ConfirmDialog from '../components/modals/ConfirmDialog'
import AppHeader from '../components/layout/AppHeader'
import type { ProjectWithCounts } from '../lib/api-types'

export default function ProjectsDashboard() {
  const navigate = useNavigate()
  const { resolvedTheme, initializeTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'

  const [projects, setProjects] = useState<ProjectWithCounts[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<ProjectWithCounts | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    initializeTheme()
  }, [initializeTheme])

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

  const handleCreateProject = async (name: string) => {
    const newProject = await apiClient.createProject({ name })
    setProjects(prev => [newProject as ProjectWithCounts, ...prev])
    addToast({ message: `Project "${name}" created`, type: 'success' })
  }

  const handleUpdateProject = async (name: string) => {
    if (!editingProject) return
    try {
      const updatedProject = await apiClient.updateProject(editingProject.id, { name })
      setProjects(prev =>
        prev.map(p => (p.id === editingProject.id ? { ...p, name: updatedProject.name } : p))
      )
      addToast({ message: `Project renamed to "${name}"`, type: 'success' })
    } catch (err) {
      throw err
    }
  }

  const handleDeleteProject = (projectId: string, projectName: string) => {
    setProjectToDelete({ id: projectId, name: projectName })
    setDeleteConfirmOpen(true)
  }

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return
    try {
      await apiClient.deleteProject(projectToDelete.id)
      setProjects(prev => prev.filter(p => p.id !== projectToDelete.id))
      addToast({ message: `Project "${projectToDelete.name}" deleted`, type: 'success' })
    } catch (err) {
      addToast({
        message: err instanceof Error ? err.message : 'Failed to delete project',
        type: 'error'
      })
    } finally {
      setDeleteConfirmOpen(false)
      setProjectToDelete(null)
    }
  }

  return (
    <div className={`min-h-screen transition-colors duration-200 ${
      isDark ? 'bg-surface-dark' : 'bg-surface'
    }`}>
      <AppHeader />

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className={`text-heading-lg ${
              isDark ? 'text-content-inverse' : 'text-content'
            }`}>
              Projects
            </h2>
            <p className={`text-body mt-1 ${
              isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
            }`}>
              Manage your AI session projects
            </p>
          </div>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Project
          </button>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className={`text-body ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
              Loading projects...
            </div>
          </div>
        )}

        {/* Error */}
        {error && !isLoading && (
          <div className={`p-4 rounded-lg text-body ${
            isDark
              ? 'bg-red-500/10 border border-red-500/20 text-red-400'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}>
            {error}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && projects.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className={`w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center ${
              isDark ? 'bg-surface-dark-secondary' : 'bg-surface-secondary'
            }`}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className={
                isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
              } stroke="currentColor" strokeWidth="1.5">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <h3 className={`text-heading mb-2 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
              No projects yet
            </h3>
            <p className={`text-body mb-6 ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
              Create your first project to get started
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="btn-primary"
            >
              Create Project
            </button>
          </motion.div>
        )}

        {/* Projects Grid */}
        {!isLoading && !error && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project, index) => (
              <motion.div
                key={project.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/project/${project.id}`)}
                className={`group cursor-pointer rounded-xl p-5 transition-all duration-200 ${
                  isDark
                    ? 'bg-surface-dark-secondary border border-border-dark hover:border-border-dark-secondary'
                    : 'bg-white border border-border shadow-sm hover:shadow-md hover:border-border-secondary'
                }`}
              >
                <h3 className={`text-heading-sm mb-3 ${
                  isDark ? 'text-content-inverse' : 'text-content'
                }`}>
                  {project.name}
                </h3>

                {/* Stats */}
                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between">
                    <span className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                      Active Sessions
                    </span>
                    <span className={`text-body-sm font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                      {project.activeSessions}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                      Active Agents
                    </span>
                    <span className={`text-body-sm font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                      {project.activeAgents}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}>
                      Total Sessions
                    </span>
                    <span className={`text-body-sm font-medium ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                      {project.totalSessions}
                    </span>
                  </div>
                </div>

                {/* Date */}
                <p className={`text-caption mb-4 ${
                  isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                }`}>
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </p>

                {/* Actions */}
                <div className={`flex gap-2 pt-4 border-t ${
                  isDark ? 'border-border-dark' : 'border-border'
                }`}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate(`/project/${project.id}`)
                    }}
                    className="btn-primary flex-1 text-ui-sm"
                  >
                    View Sessions
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingProject(project)
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      isDark
                        ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                        : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                    }`}
                    title="Edit"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteProject(project.id, project.name)
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      isDark
                        ? 'text-content-inverse-tertiary hover:text-red-400 hover:bg-red-500/10'
                        : 'text-content-tertiary hover:text-red-600 hover:bg-red-50'
                    }`}
                    title="Delete"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </main>

      {/* Modals */}
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateProject}
      />

      {editingProject && (
        <EditProjectModal
          isOpen={!!editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleUpdateProject}
          currentName={editingProject.name}
          projectId={editingProject.id}
        />
      )}

      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Project"
        message={`Delete "${projectToDelete?.name}"? This will permanently remove the project and all its sessions. This cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmVariant="danger"
        onConfirm={confirmDeleteProject}
        onCancel={() => { setDeleteConfirmOpen(false); setProjectToDelete(null) }}
      />
    </div>
  )
}

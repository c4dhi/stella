import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import LoginPage from './pages/LoginPage'
import ProjectsDashboard from './pages/ProjectsDashboard'
import SessionsDashboard from './pages/SessionsDashboard'
import SessionView from './pages/SessionView'
import ParticipantJoinPage from './pages/ParticipantJoinPage'
import ProtectedRoute from './components/auth/ProtectedRoute'
import { ToastContainer } from './components/Toast'
import { useAuthStore } from './store/authStore'
import { useToastStore } from './store/toastStore'

export default function App() {
  const { checkAuth } = useAuthStore()
  const { toasts, removeToast } = useToastStore()

  // Check authentication status on app mount
  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  return (
    <BrowserRouter>
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join/:token" element={<ParticipantJoinPage />} />

        {/* Protected Routes */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <ProjectsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/project/:projectId"
          element={
            <ProtectedRoute>
              <SessionsDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/session/:sessionId"
          element={
            <ProtectedRoute>
              <SessionView />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Catch-all - redirect to dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

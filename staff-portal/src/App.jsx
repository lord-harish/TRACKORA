import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { Layout } from './components/layout/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Assets from './pages/Assets.jsx'
import Tasks from './pages/Tasks.jsx'
import AIRecommendations from './pages/AIRecommendations.jsx'
import BlockPlans from './pages/BlockPlans.jsx'
import Assignments from './pages/Assignments.jsx'
import Progress from './pages/Progress.jsx'
import CalendarPage from './pages/CalendarPage.jsx'
import Profile from './pages/Profile.jsx'
import Notifications from './pages/Notifications.jsx'
import { Loading } from './components/ui.jsx'

function Protected({ children }) {
  const { user, authLoading, roleLoading } = useAuth()
  if (authLoading || roleLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <div style={{ width: 320 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="brand-mark">T</div>
            <b style={{ letterSpacing: 2, color: 'var(--primary)' }}>TRACKORA</b>
          </div>
          <Loading rows={3} />
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Verifying staff session…</p>
        </div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
      <Route path="/assets" element={<Protected><Assets /></Protected>} />
      <Route path="/tasks" element={<Protected><Tasks /></Protected>} />
      <Route path="/ai" element={<Protected><AIRecommendations /></Protected>} />
      <Route path="/blocks" element={<Protected><BlockPlans /></Protected>} />
      <Route path="/assignments" element={<Protected><Assignments /></Protected>} />
      <Route path="/progress" element={<Protected><Progress /></Protected>} />
      <Route path="/calendar" element={<Protected><CalendarPage /></Protected>} />
      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

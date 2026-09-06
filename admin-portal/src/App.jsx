import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { Layout } from './components/layout/Layout.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import BlockPlans from './pages/BlockPlans.jsx'
import WorkCompletion from './pages/WorkCompletion.jsx'
import TrainMovements from './pages/TrainMovements.jsx'
import Assets from './pages/Assets.jsx'
import Reports from './pages/Reports.jsx'
import CalendarPage from './pages/CalendarPage.jsx'
import AuditLogs from './pages/AuditLogs.jsx'
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
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>Verifying admin session…</p>
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
      <Route path="/block-plans" element={<Protected><BlockPlans /></Protected>} />
      <Route path="/work" element={<Protected><WorkCompletion /></Protected>} />
      <Route path="/trains" element={<Protected><TrainMovements /></Protected>} />
      <Route path="/assets" element={<Protected><Assets /></Protected>} />
      <Route path="/reports" element={<Protected><Reports /></Protected>} />
      <Route path="/calendar" element={<Protected><CalendarPage /></Protected>} />
      <Route path="/audit" element={<Protected><AuditLogs /></Protected>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

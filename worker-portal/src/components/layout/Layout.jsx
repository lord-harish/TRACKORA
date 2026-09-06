import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { initials } from '../../utils/format.js'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/tasks', label: 'Assigned Tasks', icon: '✓' },
  { to: '/blocks', label: 'Block Schedule', icon: '◧' },
  { to: '/progress', label: 'Task Progress', icon: '◔' },
  { to: '/profile', label: 'Profile', icon: '⦿' },
]

const TITLES = {
  '/dashboard': ['Dashboard', 'Your work at a glance'],
  '/tasks': ['Assigned Tasks', 'Only tasks assigned to you'],
  '/blocks': ['Block Schedule', 'Approved blocks relevant to you'],
  '/progress': ['Task Progress', 'Track and update your work'],
  '/profile': ['Profile', 'Your account information'],
  '/notifications': ['Notifications', 'Task and schedule updates'],
}

export function Layout({ children }) {
  const { profile, user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const loc = useLocation()
  const nav = useNavigate()
  const [title, sub] = TITLES[loc.pathname] || ['TRACKORA', 'Worker Portal']

  const doLogout = async () => {
    await logout()
    nav('/login', { replace: true })
  }

  const name = profile?.name || profile?.display_name || user?.email?.split('@')[0] || 'Worker'

  return (
    <div className="app-shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">TRACKORA</div>
            <div className="brand-sub">Worker Portal</div>
          </div>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          <div className="nav-label">Field Work</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <span className="ico">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Field execution only · no planning controls</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="iconbtn mobile-toggle" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <div>
            <h1>{title}</h1>
            <div className="crumb">{sub}</div>
          </div>
          <button className="iconbtn bell" title="Notifications" onClick={() => nav('/notifications')}>
            ◔<span className="dot"></span>
          </button>
          <div style={{ position: 'relative' }}>
            <div className="profile" onClick={() => setMenu(!menu)}>
              <div className="avatar">{initials(name, user?.email)}</div>
              <div className="who"><b>{name}</b><span>Worker</span></div>
            </div>
            {menu && (
              <div className="menu">
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>{user?.email}</div>
                <button onClick={() => { setMenu(false); nav('/profile') }}>⦿&nbsp; Profile</button>
                <button onClick={doLogout}>⎋&nbsp; Logout</button>
              </div>
            )}
          </div>
          <button className="btn btn-big btn-sm" onClick={doLogout}>Logout</button>
        </header>
        <main className="content">
          <div key={loc.pathname} className="page-fade">{children}</div>
        </main>
      </div>
    </div>
  )
}

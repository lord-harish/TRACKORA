import { useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { initials } from '../../utils/format.js'

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦' },
  { to: '/assets', label: 'Assets', icon: '⬡' },
  { to: '/tasks', label: 'Maintenance Tasks', icon: '✓' },
  { to: '/ai', label: 'AI Recommendations', icon: '✦' },
  { to: '/blocks', label: 'Block Plans', icon: '◧' },
  { to: '/assignments', label: 'Work Assignments', icon: '⦿' },
  { to: '/progress', label: 'Task Progress', icon: '◔' },
  { to: '/calendar', label: 'Calendar', icon: '▨' },
  { to: '/profile', label: 'Profile', icon: '⚇' },
]

const TITLES = {
  '/dashboard': ['Dashboard', 'Operational overview for planning'],
  '/assets': ['Assets', 'Track · Signal/S&T · OHE/Traction'],
  '/tasks': ['Maintenance Tasks', 'Raise and track requests'],
  '/ai': ['AI Recommendations', 'RF → XGBRanker → CP-SAT results'],
  '/blocks': ['Block Plans', 'Review plans, track approval'],
  '/assignments': ['Work Assignments', 'Coordinate workers'],
  '/progress': ['Task Progress', 'Monitor execution'],
  '/calendar': ['Calendar', 'Maintenance schedule'],
  '/profile': ['Profile', 'Your account information'],
  '/notifications': ['Notifications', 'Planning updates'],
}

export function Layout({ children }) {
  const { profile, user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [menu, setMenu] = useState(false)
  const [q, setQ] = useState('')
  const loc = useLocation()
  const nav = useNavigate()
  const [title, sub] = TITLES[loc.pathname] || ['TRACKORA', 'Staff Portal']

  const doLogout = async () => {
    await logout()
    nav('/login', { replace: true })
  }

  const name = profile?.name || profile?.display_name || user?.email?.split('@')[0] || 'Staff'

  return (
    <div className="app-shell">
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <div className="brand-name">TRACKORA</div>
            <div className="brand-sub">Staff Portal</div>
          </div>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          <div className="nav-label">Planning</div>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <span className="ico">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">Plan · Coordinate · Monitor<br />No final approval authority</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="iconbtn mobile-toggle" onClick={() => setOpen(!open)} aria-label="Menu">☰</button>
          <div>
            <h1>{title}</h1>
            <div className="crumb">{sub}</div>
          </div>
          <div className="searchbox" title="Search filters the current page where supported">
            <span>⌕</span>
            <input
              placeholder="Search this page…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                window.dispatchEvent(new CustomEvent('trackora:search', { detail: e.target.value }))
              }}
            />
          </div>
          <button className="iconbtn" title="Notifications" onClick={() => nav('/notifications')}>
            ◔<span className="dot"></span>
          </button>
          <div style={{ position: 'relative' }}>
            <div className="profile" onClick={() => setMenu(!menu)}>
              <div className="avatar">{initials(name, user?.email)}</div>
              <div className="who"><b>{name}</b><span>Staff</span></div>
            </div>
            {menu && (
              <div className="menu">
                <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)' }}>{user?.email}</div>
                <button onClick={() => { setMenu(false); nav('/profile') }}>⚇&nbsp; Profile</button>
                <button onClick={doLogout}>⎋&nbsp; Logout</button>
              </div>
            )}
          </div>
          <button className="btn btn-sm" onClick={doLogout}>Logout</button>
        </header>
        <main className="content">
          <div key={loc.pathname} className="page-fade">{children}</div>
        </main>
      </div>
    </div>
  )
}

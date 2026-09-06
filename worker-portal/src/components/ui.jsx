import { statusTone } from '../utils/format.js'

export function Loading({ rows = 3, height = 18 }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ height }}></div>
      ))}
    </div>
  )
}

export function EmptyState({ icon = '○', title = 'No records found', hint = 'Data unavailable in database' }) {
  return (
    <div className="state">
      <div className="box">{icon}</div>
      <h4>{title}</h4>
      <p>{hint}</p>
    </div>
  )
}

export function Unavailable({ collection }) {
  return (
    <EmptyState
      icon="◌"
      title="Data unavailable in database"
      hint={collection ? `Collection “${collection}” is empty or not accessible.` : 'This data is not available in the database.'}
    />
  )
}

export function Badge({ value }) {
  if (value === undefined || value === null || value === '') return <span className="muted">—</span>
  const label = String(value).replace(/_/g, ' ')
  return <span className={`badge ${statusTone(value)}`}>{label}</span>
}

export function Card({ title, sub, right, children }) {
  return (
    <div className="card">
      {(title || right) && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: sub ? 2 : 10 }}>
          <h3>{title}</h3>
          {right}
        </div>
      )}
      {sub && <p className="sub">{sub}</p>}
      {children}
    </div>
  )
}

export function Kpi({ label, value, hint, tone = '' }) {
  return (
    <div className={`card kpi ${tone}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

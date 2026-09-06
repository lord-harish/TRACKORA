import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, pick } from '../utils/format.js'

export default function AuditLogs() {
  const { rows, loading, unavailable } = useCollection('audit_logs', { max: 1000 })
  const [q, setQ] = useState('')
  const [user, setUser] = useState('all')
  const [action, setAction] = useState('all')
  const [etype, setEtype] = useState('all')
  const [date, setDate] = useState('')

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const facets = useMemo(() => ({
    users: [...new Set(rows.map((r) => pick(r, 'user', 'user_email', 'userEmail', 'actor')).filter(Boolean))],
    actions: [...new Set(rows.map((r) => pick(r, 'action')).filter(Boolean))],
    types: [...new Set(rows.map((r) => pick(r, 'entity_type', 'entityType')).filter(Boolean))],
  }), [rows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (user !== 'all' && pick(r, 'user', 'user_email', 'userEmail', 'actor') !== user) return false
      if (action !== 'all' && pick(r, 'action') !== action) return false
      if (etype !== 'all' && pick(r, 'entity_type', 'entityType') !== etype) return false
      if (date) {
        const t = pick(r, 'timestamp', 'created_at', 'createdAt')
        let iso = ''
        try {
          if (t?.toDate) iso = t.toDate().toISOString().slice(0, 10)
          else if (t?.seconds) iso = new Date(t.seconds * 1000).toISOString().slice(0, 10)
          else if (t) iso = new Date(t).toISOString().slice(0, 10)
        } catch { iso = '' }
        if (iso !== date) return false
      }
      if (!needle) return true
      return [r.id, pick(r, 'action'), pick(r, 'entity_id', 'entityId'), pick(r, 'details')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, user, action, etype, date])

  return (
    <div>
      <div className="page-head">
        <div><h2>Audit Logs</h2><p>Read directly from Firestore — every approval, rejection and status change.</p></div>
      </div>

      <div className="toolbar">
        <select className="input" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="all">All users</option>
          {facets.users.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select className="input" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="all">All actions</option>
          {facets.actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input" value={etype} onChange={(e) => setEtype(e.target.value)}>
          <option value="all">All entity types</option>
          {facets.types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {(user !== 'all' || action !== 'all' || etype !== 'all' || date) && (
          <button className="btn btn-sm" onClick={() => { setUser('all'); setAction('all'); setEtype('all'); setDate('') }}>Clear</button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} entries</span>
      </div>

      {loading ? <div className="card"><Loading rows={6} /></div>
      : unavailable ? <div className="card"><Unavailable collection="audit_logs" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No audit entries" hint={rows.length === 0 ? 'Data unavailable in database' : 'No entries match these filters.'} /></div>
      : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Previous</th><th>New</th><th>Details</th></tr></thead>
            <tbody>
              {filtered.slice(0, 300).map((r) => (
                <tr key={r.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDate(pick(r, 'timestamp', 'created_at', 'createdAt'))}</td>
                  <td>{pick(r, 'user', 'user_email', 'userEmail', 'actor') || '—'}</td>
                  <td><b style={{ fontSize: 12 }}>{pick(r, 'action') || '—'}</b></td>
                  <td>{pick(r, 'entity_type', 'entityType') || '—'}</td>
                  <td className="id">{pick(r, 'entity_id', 'entityId') || '—'}</td>
                  <td><Badge value={pick(r, 'previous_status', 'prev_status', 'prevStatus')} /></td>
                  <td><Badge value={pick(r, 'new_status', 'newStatus')} /></td>
                  <td className="muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pick(r, 'details', 'note', 'message') || ''}>{pick(r, 'details', 'note', 'message') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

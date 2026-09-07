import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '../hooks/useCollection.js'
import { EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, pick, toDate } from '../utils/format.js'

// Planning-relevant notifications derived from live collections.
export default function Notifications() {
  const nav = useNavigate()
  const tasks = useCollection('maintenance_tasks', { max: 200 })
  const blocks = useCollection('block_plans', { max: 200 })
  const assigns = useCollection('work_assignments', { max: 200 })
  const updates = useCollection('status_updates', { max: 200 })
  const direct = useCollection('notifications', { max: 100 })

  const items = useMemo(() => {
    const out = []
    const push = (kind, title, at, detail, link) => {
      const d = toDate(at)
      if (d) out.push({ id: `${kind}-${title}-${d.getTime()}`, kind, title, at: d, detail, link })
    }
    if (!tasks.unavailable) {
      tasks.rows.slice(0, 10).forEach((t) => {
        if (pick(t, 'created_at')) push('task', `New request: ${pick(t, 'task_id', 'title') || t.id}`, pick(t, 'created_at'), `${pick(t, 'section') || ''}`, '/tasks')
      })
    }
    if (!blocks.unavailable) {
      blocks.rows.slice(0, 10).forEach((b) => {
        push('block', `Block ${pick(b, 'status', 'approval_status') || 'update'}: ${pick(b, 'plan_id') || b.id}`,
          pick(b, 'updated_at', 'created_at'), `${pick(b, 'section') || ''}`, '/blocks')
      })
    }
    if (!assigns.unavailable) {
      assigns.rows.slice(0, 10).forEach((a) => {
        push('assign', `Assignment: ${pick(a, 'task_id') || a.id} → ${pick(a, 'worker', 'assignee') || ''}`,
          pick(a, 'created_at', 'assigned_at'), '', '/assignments')
      })
    }
    if (!updates.unavailable) {
      updates.rows.slice(0, 10).forEach((u) => {
        push('update', `Status: ${pick(u, 'task_id') || u.id} → ${pick(u, 'new_status', 'status') || ''}`,
          pick(u, 'timestamp', 'created_at'), `${pick(u, 'worker', 'user') || ''}`, '/progress')
      })
    }
    if (!direct.unavailable) {
      direct.rows.forEach((n) => {
        push('notice', pick(n, 'title', 'message') || n.id, pick(n, 'timestamp', 'created_at'), pick(n, 'details', 'body') || '', null)
      })
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 30)
  }, [tasks, blocks, assigns, updates, direct])

  const allUnavailable = tasks.unavailable && blocks.unavailable && assigns.unavailable && updates.unavailable && direct.unavailable
  const loading = tasks.loading || blocks.loading
  const KIND = { task: 'b-blue', block: 'b-amber', assign: 'b-gray', update: 'b-green', notice: 'b-blue' }

  return (
    <div>
      <div className="page-head">
        <div><h2>Notifications</h2><p>Requests, blocks, assignments and execution updates.</p></div>
      </div>
      {loading ? <div className="card"><Loading rows={4} /></div>
      : allUnavailable ? <div className="card"><Unavailable collection="maintenance_tasks / block_plans / work_assignments" /></div>
      : items.length === 0 ? <div className="card"><EmptyState title="Nothing new" hint="No planning updates right now." /></div>
      : (
        <div className="grid" style={{ gap: 10 }}>
          {items.map((n) => (
            <div key={n.id} className="card" style={{ padding: 14 }} onClick={() => n.link && nav(n.link)}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{n.title}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{fmtDate(n.at)}{n.detail ? ` · ${n.detail}` : ''}</div>
                </div>
                <span className={`badge ${KIND[n.kind] || 'b-gray'}`}>{n.kind}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

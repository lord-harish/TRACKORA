import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '../hooks/useCollection.js'
import { EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, pick, toDate } from '../utils/format.js'
import { assignmentBelongsTo, myTasks } from '../services/workerScope.js'
import { useAuth } from '../context/AuthContext.jsx'

// Worker-relevant notifications derived from live collections:
// new assignments, block updates touching my work, task changes.
// If a dedicated `notifications` collection exists it is merged in.
export default function Notifications() {
  const { user, profile } = useAuth()
  const nav = useNavigate()
  const assignsQ = useCollection('work_assignments', { max: 200 })
  const tasksQ = useCollection('maintenance_tasks', { max: 500 })
  const blocksQ = useCollection('block_plans', { max: 200 })
  const updatesQ = useCollection('status_updates', { max: 200 })
  const directQ = useCollection('notifications', { max: 100 })

  const items = useMemo(() => {
    const out = []
    const push = (kind, title, at, detail, link) => {
      const d = toDate(at)
      if (d) out.push({ id: `${kind}-${title}-${d.getTime()}`, kind, title, at: d, detail, link })
    }
    if (!assignsQ.unavailable) {
      assignsQ.rows.filter((a) => assignmentBelongsTo(a, user)).slice(0, 10).forEach((a) => {
        push('assignment', `New task assigned: ${pick(a, 'task_id', 'taskId') || a.id}`,
          pick(a, 'assigned_at', 'created_at'), `${pick(a, 'section', 'location') || ''} · ${pick(a, 'status') || ''}`.trim(), '/tasks')
      })
    }
    if (!tasksQ.unavailable && !assignsQ.unavailable) {
      const mine = myTasks(tasksQ.rows, assignsQ.rows.filter((a) => assignmentBelongsTo(a, user)), user)
      const ids = new Set(mine.map((t) => String(pick(t, 'task_id', 'taskId') || t.id)))
      mine.slice(0, 10).forEach((t) => {
        if (pick(t, 'updated_at', 'updatedAt')) {
          push('task', `Task update: ${pick(t, 'task_id') || t.id}`, pick(t, 'updated_at', 'updatedAt'),
            `${pick(t, 'status', 'task_status') || ''}`, '/tasks')
        }
        void ids
      })
    }
    if (!blocksQ.unavailable) {
      blocksQ.rows
        .filter((b) => ['approved', 'active'].includes(String(pick(b, 'status', 'approval_status') || '').toLowerCase()))
        .slice(0, 10)
        .forEach((b) => {
          push('block', `Block schedule: ${pick(b, 'plan_id') || b.id}`, pick(b, 'updated_at', 'created_at', 'start_time'),
            `${pick(b, 'section', 'location') || ''} · ${fmtDate(pick(b, 'start_time', 'startTime'))}`, '/blocks')
        })
    }
    if (!updatesQ.unavailable) {
      updatesQ.rows.slice(0, 10).forEach((u) => {
        const w = pick(u, 'worker_id', 'worker', 'user')
        const isMine = w && user && (String(w).toLowerCase() === String(user.uid).toLowerCase())
        if (!isMine) return
        push('update', `Your update recorded: ${pick(u, 'task_id', 'taskId') || u.id}`,
          pick(u, 'timestamp', 'created_at'), `${pick(u, 'new_status', 'status') || ''}`, '/progress')
      })
    }
    if (!directQ.unavailable) {
      directQ.rows.forEach((n) => {
        const forMe = ['worker', 'all', user?.email, user?.uid].includes(pick(n, 'audience', 'role', 'to'))
        if (!forMe && directQ.rows.length > 0 && pick(n, 'audience')) return
        push('notice', pick(n, 'title', 'message') || n.id, pick(n, 'timestamp', 'created_at'),
          pick(n, 'details', 'body') || '', null)
      })
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 30)
  }, [assignsQ, tasksQ, blocksQ, updatesQ, directQ, user])

  const allUnavailable = assignsQ.unavailable && tasksQ.unavailable && blocksQ.unavailable && updatesQ.unavailable && directQ.unavailable
  const loading = assignsQ.loading || tasksQ.loading || blocksQ.loading

  const KIND = { assignment: 'b-blue', block: 'b-amber', task: 'b-gray', update: 'b-green', notice: 'b-blue' }

  return (
    <div>
      <div className="page-head">
        <div><h2>Notifications</h2><p>Only updates relevant to your work. No admin or staff notices here.</p></div>
      </div>
      {loading ? <div className="card"><Loading rows={4} /></div>
      : allUnavailable ? <div className="card"><Unavailable collection="work_assignments / block_plans / status_updates" /></div>
      : items.length === 0 ? <div className="card"><EmptyState title="Nothing new" hint="No task or schedule updates for you right now." /></div>
      : (
        <div className="grid" style={{ gap: 10 }}>
          {items.map((n) => (
            <div key={n.id} className="task-card" style={{ padding: 14 }} onClick={() => n.link && nav(n.link)}>
              <div className="thead">
                <div>
                  <div className="tname" style={{ fontSize: 15 }}>{n.title}</div>
                  <div className="muted">{fmtDate(n.at)}{n.detail ? ` · ${n.detail}` : ''}</div>
                </div>
                <span className={`badge ${KIND[n.kind] || 'b-gray'}`}>{n.kind}</span>
              </div>
            </div>
          ))}
          <p className="muted" style={{ fontSize: 12 }}>Notifications are derived from your assignments, blocks and updates in the database.</p>
        </div>
      )}
    </div>
  )
}

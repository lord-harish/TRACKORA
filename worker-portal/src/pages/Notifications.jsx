import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '../hooks/useCollection.js'
import { EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, pick, toDate } from '../utils/format.js'
import { assignmentBelongsTo, myBlocks, myTasks, taskIdOf } from '../services/workerScope.js'
import { useAuth } from '../context/AuthContext.jsx'

// Worker-relevant notifications ONLY: derived from the worker's own
// assignments, their linked tasks/blocks, and their own updates.
// If a dedicated `notifications` collection exists, only entries
// addressed to this worker (or everyone) are merged in.
export default function Notifications() {
  const { user, profile } = useAuth()
  const nav = useNavigate()
  const assignsQ = useCollection('work_assignments', { max: 200 })
  const tasksQ = useCollection('maintenance_tasks', { max: 500 })
  const blocksQ = useCollection('block_plans', { max: 200 })
  const updatesQ = useCollection('status_updates', { max: 200 })
  const directQ = useCollection('notifications', { max: 100 })

  const scope = useMemo(() => {
    const myAssigns = assignsQ.unavailable ? [] : assignsQ.rows.filter((a) => assignmentBelongsTo(a, user, profile))
    const tasks = tasksQ.unavailable ? [] : myTasks(tasksQ.rows, myAssigns, user, profile)
    const ids = new Set(tasks.map((t) => taskIdOf(t)))
    const blocks = blocksQ.unavailable ? [] : myBlocks(blocksQ.rows, ids, profile)
    return { myAssigns, tasks, ids, blocks }
  }, [assignsQ, tasksQ, blocksQ, user, profile])

  const items = useMemo(() => {
    const out = []
    const push = (kind, title, at, detail, link) => {
      const d = toDate(at)
      if (d) out.push({ id: `${kind}-${title}-${d.getTime()}`, kind, title, at: d, detail, link })
    }
    scope.myAssigns.slice(0, 10).forEach((a) => {
      push('assignment', `New task assigned: ${taskIdOf(a) || a.id}`,
        pick(a, 'assigned_at', 'created_at'), `${pick(a, 'section', 'location') || ''} · ${pick(a, 'status') || ''}`.trim(), '/tasks')
    })
    scope.tasks.slice(0, 10).forEach((t) => {
      if (pick(t, 'updated_at', 'updatedAt')) {
        push('task', `Task update: ${taskIdOf(t)}`, pick(t, 'updated_at', 'updatedAt'),
          `${pick(t, 'status', 'task_status') || ''}`, '/tasks')
      }
    })
    scope.blocks.slice(0, 10).forEach((b) => {
      push('block', `Block schedule: ${pick(b, 'plan_id') || b.id}`,
        pick(b, 'updated_at', 'created_at', 'start_time'),
        `${pick(b, 'section', 'location') || ''} · ${fmtDate(pick(b, 'start_time', 'startTime'))}`, '/blocks')
    })
    if (!updatesQ.unavailable) {
      updatesQ.rows.forEach((u) => {
        const tid = taskIdOf(u)
        const w = pick(u, 'employee_id', 'employeeId', 'emp_id', 'worker_id', 'worker', 'user', 'user_email', 'userEmail')
        const empId = scope?.profile?.employee_id || 'EMP003'
        const isMine = (tid && scope.ids.has(tid)) || (w && (
          String(w).trim().toLowerCase() === String(empId).toLowerCase() ||
          (user && (
            String(w).trim().toLowerCase() === String(user.uid || '').toLowerCase() ||
            String(w).trim().toLowerCase() === String(user.email || '').toLowerCase()
          ))
        ))
        if (!isMine) return
        push('update', `Your update recorded: ${tid || u.id}`,
          pick(u, 'timestamp', 'created_at'), `${pick(u, 'new_status', 'status') || ''}`, '/progress')
      })
    }
    if (!directQ.unavailable) {
      const me = [String(user?.uid || '').toLowerCase(), String(user?.email || '').toLowerCase()]
      directQ.rows.forEach((n) => {
        const aud = String(pick(n, 'audience', 'role', 'to', 'target') || 'all').toLowerCase()
        if (aud !== 'all' && aud !== 'worker' && aud !== 'workers' && !me.includes(aud)) return
        push('notice', pick(n, 'title', 'message') || n.id, pick(n, 'timestamp', 'created_at'),
          pick(n, 'details', 'body') || '', null)
      })
    }
    return out.sort((a, b) => b.at - a.at).slice(0, 30)
  }, [scope, updatesQ, directQ, user])

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
      : items.length === 0 ? <div className="card"><EmptyState title="Nothing new" hint="No task or schedule updates linked to your assignments right now." /></div>
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
          <p className="muted" style={{ fontSize: 12 }}>Notifications are derived from your assignments, linked blocks and updates in the database.</p>
        </div>
      )}
    </div>
  )
}

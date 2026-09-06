import { useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick, toDate } from '../utils/format.js'
import { assignmentBelongsTo, myTasks, taskBucket } from '../services/workerScope.js'
import { StatusActions } from '../components/StatusUpdate.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function Progress() {
  const { user } = useAuth()
  const tasksQ = useCollection('maintenance_tasks', { max: 1000 })
  const assignsQ = useCollection('work_assignments', { max: 1000 })
  const updatesQ = useCollection('status_updates', { max: 500 })
  const [openId, setOpenId] = useState(null)

  const mine = useMemo(() => {
    const myAssigns = assignsQ.rows.filter((a) => assignmentBelongsTo(a, user))
    return { myAssigns, tasks: myTasks(tasksQ.rows, myAssigns, user) }
  }, [tasksQ.rows, assignsQ.rows, user])

  const updatesByTask = useMemo(() => {
    const m = {}
    if (updatesQ.unavailable) return m
    updatesQ.rows.forEach((u) => {
      const t = pick(u, 'task_id', 'taskId')
      if (!t) return
      const k = String(t)
      if (!m[k]) m[k] = []
      m[k].push(u)
    })
    Object.values(m).forEach((l) => l.sort((a, b) => (toDate(pick(b, 'timestamp', 'created_at')) || 0) - (toDate(pick(a, 'timestamp', 'created_at')) || 0)))
    return m
  }, [updatesQ])

  const loading = tasksQ.loading || assignsQ.loading
  const unavailable = tasksQ.unavailable && assignsQ.unavailable

  const summary = useMemo(() => {
    const s = { pending: 0, in_progress: 0, completed: 0, delayed: 0 }
    mine.tasks.forEach((t) => {
      const b = taskBucket(t)
      if (s[b] !== undefined) s[b] += 1
    })
    const total = mine.tasks.length
    const pct = total ? Math.round((s.completed / total) * 100) : 0
    return { ...s, total, pct }
  }, [mine.tasks])

  const assignmentFor = (t) => {
    const tid = String(pick(t, 'task_id', 'taskId') || t.id)
    return mine.myAssigns.find((a) => String(pick(a, 'task_id', 'taskId') || '') === tid) || null
  }

  const timeline = (t) => {
    const ups = updatesByTask[String(pick(t, 'task_id', 'taskId') || t.id)] || updatesByTask[String(t.id)] || []
    const steps = [
      { key: 'assigned', label: 'Assigned', at: pick(t, 'assigned_at', 'created_at') },
      { key: 'in_progress', label: 'Started', at: pick(t, 'actual_start', 'actualStart') || ups.find((u) => normStatus(pick(u, 'new_status', 'status')) === 'in_progress' && pick(u, 'timestamp', 'created_at'))?.timestamp },
      { key: 'completed', label: 'Completed', at: pick(t, 'actual_completion', 'completed_at') || ups.find((u) => ['completed', 'complete', 'done'].includes(normStatus(pick(u, 'new_status', 'status'))) && pick(u, 'timestamp', 'created_at'))?.timestamp },
    ]
    return { steps, latest: ups[0] || null, all: ups }
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Task Progress</h2><p>Your timeline, planned vs actual, and quick updates.</p></div>
      </div>

      {loading ? <div className="card"><Loading rows={3} /></div>
      : unavailable ? <div className="card"><Unavailable collection="maintenance_tasks / work_assignments" /></div>
      : (
        <div>
          <Card title={`${summary.pct}% complete`} sub={`${summary.completed} of ${summary.total} tasks done · ${summary.in_progress} in progress · ${summary.pending} pending · ${summary.delayed} delayed`}>
            <div style={{ background: 'var(--surface-2)', borderRadius: 999, height: 14, overflow: 'hidden' }}>
              <div style={{ width: `${summary.pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }}></div>
            </div>
          </Card>

          <div className="grid" style={{ gap: 12, marginTop: 14 }}>
            {mine.tasks.length === 0 && <div className="card"><EmptyState title="No tasks" hint="No assignments found for your account." /></div>}
            {mine.tasks.map((t) => {
              const tl = timeline(t)
              const open = openId === t.id
              const ups = tl.all
              return (
                <div key={t.id} className="task-card">
                  <div className="thead">
                    <div>
                      <div className="tname">{pick(t, 'title', 'task_name', 'description') || pick(t, 'task_id') || t.id}</div>
                      <div className="muted mono">{pick(t, 'task_id') || t.id}</div>
                    </div>
                    <Badge value={pick(t, 'status', 'task_status')} />
                  </div>
                  <div className="meta">
                    <span><b>Planned</b>{fmtDate(pick(t, 'planned_date', 'scheduled_date', 'due_date'))}</span>
                    <span><b>Started</b>{fmtDate(pick(t, 'actual_start', 'actualStart'))}</span>
                    <span><b>Done</b>{fmtDate(pick(t, 'actual_completion', 'completed_at'))}</span>
                  </div>
                  <div className="timeline">
                    {tl.steps.map((s, i) => (
                      <div key={s.key} className={`tl-item ${s.at ? 'done' : i === tl.steps.findIndex((x) => !x.at) ? 'now' : ''}`}>
                        <div className="tl-dot">{s.at ? '✓' : '○'}</div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14 }}>{s.label}</div>
                          <div className="muted" style={{ fontSize: 12 }}>{s.at ? fmtDate(s.at) : 'Pending'}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {tl.latest && (
                    <div className="muted" style={{ fontSize: 13 }}>
                      Latest: <b>{pick(tl.latest, 'new_status', 'status') || 'update'}</b> · {fmtDate(pick(tl.latest, 'timestamp', 'created_at'))}
                      {pick(tl.latest, 'message', 'remarks') ? ` · ${pick(tl.latest, 'message', 'remarks')}` : ''}
                    </div>
                  )}
                  {updatesQ.unavailable && <p className="muted" style={{ fontSize: 12 }}>Update history unavailable in database (status_updates).</p>}
                  <button className="btn btn-block" onClick={() => setOpen(open ? null : t.id)}>
                    {open ? 'Close update panel' : 'Update status'}
                  </button>
                  {open && (
                    <div>
                      <div className="divider"></div>
                      <StatusActions task={t} assignment={assignmentFor(t)} user={user} onDone={() => {}} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

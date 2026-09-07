import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, Kpi, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, isToday, pick, toDate } from '../utils/format.js'
import { assignmentBelongsTo, myBlocks, myTasks, taskBucket, taskIdOf } from '../services/workerScope.js'
import { useAuth } from '../context/AuthContext.jsx'
import RailwayGIS from '../gis/RailwayGIS.jsx'

export default function Dashboard() {
  const nav = useNavigate()
  const { user, profile } = useAuth()
  const tasksQ = useCollection('maintenance_tasks', { max: 1000 })
  const assignsQ = useCollection('work_assignments', { max: 1000 })
  const blocksQ = useCollection('block_plans', { max: 500 })
  const updatesQ = useCollection('status_updates', { max: 200 })

  const loading = tasksQ.loading || assignsQ.loading
  const scopedUnavailable = tasksQ.unavailable && assignsQ.unavailable

  const mine = useMemo(() => {
    const myAssigns = assignsQ.rows.filter((a) => assignmentBelongsTo(a, user, profile))
    const tasks = myTasks(tasksQ.rows, myAssigns, user, profile)
    const buckets = { pending: 0, in_progress: 0, completed: 0, delayed: 0 }
    tasks.forEach((t) => {
      const b = taskBucket(t)
      if (buckets[b] !== undefined) buckets[b] += 1
    })
    const today = tasks.filter((t) => {
      const d = toDate(pick(t, 'planned_date', 'due_date', 'scheduled_date', 'start_time'))
      if (!d) return false
      const n = new Date()
      return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
    })
    const actionables = tasks
      .filter((t) => !['completed', 'complete', 'done', 'closed'].includes(String(pick(t, 'status', 'task_status') || '').toLowerCase()))
      .sort((a, b) => (toDate(pick(a, 'planned_date', 'due_date')) || new Date(8640000000000000)) - (toDate(pick(b, 'planned_date', 'due_date')) || new Date(8640000000000000)))
    return { myAssigns, tasks, buckets, today, actionables }
  }, [tasksQ.rows, assignsQ.rows, user, profile])

  const nextBlock = useMemo(() => {
    if (blocksQ.unavailable) return null
    const ids = new Set(mine.tasks.map((t) => taskIdOf(t)))
    const rel = myBlocks(blocksQ.rows, ids, profile)
      .filter((b) => !['cancelled', 'canceled', 'completed', 'complete', 'done'].includes(String(pick(b, 'status', 'approval_status') || '').toLowerCase()))
      .sort((a, b) => (toDate(pick(a, 'start_time', 'startTime')) || new Date(8640000000000000)) - (toDate(pick(b, 'start_time', 'startTime')) || new Date(8640000000000000)))
    return rel[0] || null
  }, [blocksQ, mine.tasks, profile])

  const recentUpdates = useMemo(() => {
    if (updatesQ.unavailable) return []
    const ids = new Set(mine.tasks.map((t) => taskIdOf(t)))
    const myEmpId = profile?.employee_id || profile?.employeeId || profile?.emp_id || 'EMP003'
    return updatesQ.rows
      .filter((u) => {
        const t = taskIdOf(u)
        if (t && ids.has(String(t))) return true
        const w = pick(u, 'employee_id', 'employeeId', 'emp_id', 'worker_id', 'worker', 'user', 'user_email')
        if (w && String(w).toLowerCase() === String(myEmpId).toLowerCase()) return true
        return w && user && (String(w).toLowerCase() === String(user.uid).toLowerCase() || String(w).toLowerCase() === String(user.email || '').toLowerCase())
      })
      .sort((a, b) => (toDate(pick(b, 'timestamp', 'created_at')) || 0) - (toDate(pick(a, 'timestamp', 'created_at')) || 0))
      .slice(0, 5)
  }, [updatesQ, mine.tasks, user, profile])

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Namaste, {profile?.name || user?.email?.split('@')[0] || 'Worker'} <span style={{ fontSize: '0.85em', color: 'var(--muted)', fontWeight: 400 }}>({profile?.employee_id || 'EMP003'})</span></h2>
          <p>Here is what needs your attention today.</p>
        </div>
        <button className="btn btn-primary" onClick={() => nav('/tasks')}>View my tasks</button>
      </div>

      {loading ? (
        <div className="grid kpis">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="card"><Loading rows={2} /></div>)}</div>
      ) : scopedUnavailable ? (
        <div className="card"><Unavailable collection="maintenance_tasks / work_assignments" /></div>
      ) : (
        <div className="grid kpis">
          <Kpi label="Assigned Tasks" value={mine.tasks.length} hint="my assignments" />
          <Kpi label="Today's Tasks" value={mine.today.length} hint="scheduled today" tone={mine.today.length ? 'warn' : ''} />
          <Kpi label="In Progress" value={mine.buckets.in_progress} hint="being worked" tone={mine.buckets.in_progress ? 'warn' : ''} />
          <Kpi label="Completed" value={mine.buckets.completed} hint="done" tone="good" />
          <Kpi label="Delayed" value={mine.buckets.delayed} hint="needs attention" tone={mine.buckets.delayed ? 'critical' : ''} />
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Today's Work" sub={mine.today.length ? `${mine.today.length} task(s) scheduled today` : 'Tasks due next'} right={<button className="btn btn-sm" onClick={() => nav('/tasks')}>Open</button>}>
          {loading ? <Loading rows={3} /> : scopedUnavailable ? <Unavailable collection="maintenance_tasks" /> : (() => {
            const list = (mine.today.length ? mine.today : mine.actionables).slice(0, 4)
            if (!list.length) return <p className="muted">No pending tasks assigned to you.</p>
            return (
              <div style={{ display: 'grid', gap: 10 }}>
                {list.map((t) => (
                  <div key={t.id} className="task-card" style={{ padding: 14 }}>
                    <div className="thead">
                      <div>
                        <div className="tname">{pick(t, 'title', 'task_name', 'description') || pick(t, 'task_id') || t.id}</div>
                        <div className="muted mono">{pick(t, 'task_id') || t.id} · {pick(t, 'section', 'location') || '—'}</div>
                      </div>
                      <Badge value={pick(t, 'status', 'task_status')} />
                    </div>
                    <div className="meta">
                      <span><b>Time</b>{fmtDate(pick(t, 'planned_date', 'scheduled_date', 'due_date', 'start_time'))}</span>
                      <span><b>Priority</b>{pick(t, 'priority', 'priority_score', 'risk_level') ?? '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </Card>

        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="Next Block" sub="Approved block relevant to you" right={<button className="btn btn-sm" onClick={() => nav('/blocks')}>Schedule</button>}>
            {blocksQ.loading ? <Loading rows={2} /> : blocksQ.unavailable ? <Unavailable collection="block_plans" /> : !nextBlock ? (
              <p className="muted">No upcoming block linked to your work right now.</p>
            ) : (
              <div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <b>{pick(nextBlock, 'plan_id') || nextBlock.id} · {pick(nextBlock, 'section', 'location') || ''}</b>
                  <Badge value={pick(nextBlock, 'status', 'approval_status')} />
                </div>
                <p className="muted" style={{ margin: '6px 0 0' }}>
                  {(() => {
                    const s = pick(nextBlock, 'block_start', 'blockStart', 'start_time', 'startTime', 'start')
                    const e = pick(nextBlock, 'block_end', 'blockEnd', 'end_time', 'endTime', 'end')
                    const sf = s ? fmtDate(s) : ''
                    const ef = e ? fmtDate(e) : ''
                    if (sf && ef && sf !== '—' && ef !== '—') return `${sf} → ${ef}`
                    if (sf && sf !== '—') return `Start: ${sf}`
                    return 'Scheduled Possession Window'
                  })()}
                </p>
              </div>
            )}
          </Card>

          <Card title="Recent Updates" sub="Latest status on your tasks" right={<button className="btn btn-sm" onClick={() => nav('/progress')}>Progress</button>}>
            {updatesQ.loading ? <Loading rows={2} /> : updatesQ.unavailable ? <Unavailable collection="status_updates" /> : recentUpdates.length === 0 ? (
              <p className="muted">No updates recorded yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {recentUpdates.map((u) => (
                  <div key={u.id} style={{ fontSize: 13, borderBottom: '1px solid var(--border-soft)', paddingBottom: 8 }}>
                    <b>{pick(u, 'task_id', 'taskId') || u.id}</b> → <Badge value={pick(u, 'new_status', 'status')} />
                    <div className="muted">{fmtDate(pick(u, 'timestamp', 'created_at'))}{pick(u, 'message', 'remarks') ? ` · ${pick(u, 'message', 'remarks')}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <RailwayGIS tasks={mine.tasks} />
    </div>
  )
}

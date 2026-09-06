import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'

export default function WorkCompletion() {
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const assigns = useCollection('work_assignments', { max: 1000 })
  const updates = useCollection('status_updates', { max: 500 })
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const stats = useMemo(() => {
    const T = tasks.rows
    const tn = (r) => normStatus(pick(r, 'status', 'task_status', 'state'))
    const total = T.length
    const completed = T.filter((r) => ['completed', 'complete', 'done', 'closed'].includes(tn(r))).length
    const inprog = T.filter((r) => ['in_progress', 'inprogress', 'assigned', 'ongoing', 'active'].includes(tn(r))).length
    const pending = T.filter((r) => ['pending', 'planned', 'open', 'todo', 'scheduled'].includes(tn(r))).length
    const delayed = T.filter((r) => ['delayed', 'overdue'].includes(tn(r))).length
    const pct = total ? Math.round((completed / total) * 100) : 0
    const byDept = {}
    T.forEach((r) => {
      const d = pick(r, 'department', 'dept', 'team') || 'Unassigned'
      if (!byDept[d]) byDept[d] = { dept: d, total: 0, done: 0 }
      byDept[d].total += 1
      if (['completed', 'complete', 'done', 'closed'].includes(tn(r))) byDept[d].done += 1
    })
    const deptChart = Object.values(byDept).map((d) => ({ ...d, pct: d.total ? Math.round((d.done / d.total) * 100) : 0 }))
    return { total, completed, inprog, pending, delayed, pct, deptChart, depts: Object.keys(byDept) }
  }, [tasks.rows])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.rows.filter((r) => {
      if (dept !== 'all' && (pick(r, 'department', 'dept', 'team') || 'Unassigned') !== dept) return false
      if (!needle) return true
      return [r.id, pick(r, 'task_id'), pick(r, 'title', 'description'), pick(r, 'assigned_worker', 'assignee'), pick(r, 'section')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [tasks.rows, q, dept])

  const assignFor = (taskId) => assigns.rows.filter((a) => {
    const t = pick(a, 'task_id', 'taskId')
    return t && taskId && String(t) === String(taskId)
  })
  const updatesFor = (taskId) => updates.rows.filter((u) => {
    const t = pick(u, 'task_id', 'taskId')
    return t && taskId && String(t) === String(taskId)
  }).slice(0, 10)

  return (
    <div>
      <div className="page-head">
        <div><h2>Work Completion</h2><p>Tasks, assignments and live status updates from Firestore.</p></div>
      </div>

      {tasks.loading ? <div className="grid cols-3"><div className="card"><Loading /></div><div className="card"><Loading /></div><div className="card"><Loading /></div></div>
      : tasks.unavailable ? <div className="card"><Unavailable collection="maintenance_tasks" /></div>
      : (
        <>
          <div className="grid cols-3">
            <Card title={`${stats.pct}% complete`} sub={`${stats.completed} of ${stats.total} tasks completed`}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                <div style={{ width: `${stats.pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }}></div>
              </div>
              <div className="row muted" style={{ marginTop: 10, fontSize: 12 }}>
                <span>✓ {stats.completed} done</span><span>◔ {stats.inprog} in progress</span>
                <span>○ {stats.pending} pending</span><span style={{ color: 'var(--danger)' }}>! {stats.delayed} delayed</span>
              </div>
            </Card>
            <Card title="Department-wise completion" sub="Completed share per department">
              {stats.deptChart.length === 0 ? <p className="muted">Data unavailable in database</p> : (
                <div style={{ height: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.deptChart} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} hide />
                      <YAxis type="category" dataKey="dept" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v) => [`${v}%`, 'Complete']} />
                      <Bar dataKey="pct" fill="#12325b" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Status updates" sub={updates.unavailable ? 'Data unavailable in database (status_updates)' : `${updates.rows.length} updates in database`}>
              {updates.unavailable ? <Unavailable collection="status_updates" />
              : updates.rows.length === 0 ? <p className="muted">No status updates recorded yet.</p>
              : <div style={{ display: 'grid', gap: 8 }}>{updates.rows.slice(0, 4).map((u) => (
                <div key={u.id} style={{ fontSize: 12, borderBottom: '1px solid var(--border-soft)', paddingBottom: 8 }}>
                  <b>{pick(u, 'task_id', 'taskId') || u.id}</b> · {pick(u, 'message', 'note', 'status') || pick(u, 'new_status') || 'update'}
                  <div className="muted">{fmtDate(pick(u, 'timestamp', 'created_at'))}</div>
                </div>))}</div>}
            </Card>
          </div>

          <div className="toolbar" style={{ marginTop: 14 }}>
            <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="all">All departments</option>
              {stats.depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12 }}>{rows.length} tasks · assignments from {assigns.unavailable ? 'unavailable database' : `${assigns.rows.length} records`}</span>
          </div>

          {rows.length === 0 ? <div className="card"><EmptyState title="No tasks" hint="No maintenance tasks match the current filter." /></div> : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Task</th><th>Department</th><th>Worker</th><th>Planned → Actual</th><th>Progress</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.id}>
                      <td><b className="mono">{pick(r, 'task_id') || r.id}</b><br /><span className="muted">{pick(r, 'title', 'description', 'asset_id') || ''}</span></td>
                      <td>{pick(r, 'department', 'dept', 'team') || '—'}</td>
                      <td>{pick(r, 'assigned_worker', 'assignee', 'worker', 'worker_name') || (assigns.unavailable ? '—' : (assignFor(pick(r, 'task_id') || r.id)[0] ? pick(assignFor(pick(r, 'task_id') || r.id)[0], 'worker', 'worker_name', 'assignee') || 'assigned' : '—'))}</td>
                      <td className="muted">{fmtDate(pick(r, 'planned_date', 'planned_completion', 'due_date'))} → {fmtDate(pick(r, 'actual_completion', 'completed_at', 'actual_date'))}</td>
                      <td>{pick(r, 'completion_percentage', 'progress', 'completion_pct') != null ? `${pick(r, 'completion_percentage', 'progress', 'completion_pct')}%` : '—'}</td>
                      <td><Badge value={pick(r, 'status', 'task_status')} /></td>
                      <td><button className="btn btn-sm" onClick={() => setSelected(r)}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{pick(selected, 'task_id') || selected.id}</h3>
              <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <p className="muted">{pick(selected, 'title', 'description') || 'Task detail'}</p>
            <dl className="kv">
              <dt>Status</dt><dd><Badge value={pick(selected, 'status', 'task_status')} /></dd>
              <dt>Department</dt><dd>{pick(selected, 'department', 'dept', 'team') || '—'}</dd>
              <dt>Worker</dt><dd>{pick(selected, 'assigned_worker', 'assignee', 'worker') || '—'}</dd>
              <dt>Planned</dt><dd>{fmtDate(pick(selected, 'planned_date', 'planned_completion', 'due_date'))}</dd>
              <dt>Actual</dt><dd>{fmtDate(pick(selected, 'actual_completion', 'completed_at'))}</dd>
              <dt>Priority</dt><dd>{pick(selected, 'priority_score', 'priority', 'risk_level') ?? '—'}</dd>
              <dt>Section</dt><dd>{pick(selected, 'section', 'location') || '—'}</dd>
            </dl>
            <h4>Work assignments</h4>
            {assigns.unavailable ? <p className="muted">Data unavailable in database (work_assignments).</p>
            : assignFor(pick(selected, 'task_id') || selected.id).length === 0 ? <p className="muted">No assignments linked to this task.</p>
            : assignFor(pick(selected, 'task_id') || selected.id).map((a) => (
              <div key={a.id} className="card" style={{ padding: 10, marginBottom: 8 }}>
                <b style={{ fontSize: 13 }}>{pick(a, 'worker', 'worker_name', 'assignee') || a.id}</b>
                <div className="muted" style={{ fontSize: 12 }}>{fmtDate(pick(a, 'assigned_at', 'created_at'))} · <Badge value={pick(a, 'status')} /></div>
              </div>))}
            <h4>Status updates</h4>
            {updates.unavailable ? <p className="muted">Data unavailable in database (status_updates).</p>
            : updatesFor(pick(selected, 'task_id') || selected.id).length === 0 ? <p className="muted">No status updates for this task.</p>
            : updatesFor(pick(selected, 'task_id') || selected.id).map((u) => (
              <div key={u.id} style={{ fontSize: 12, padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <b>{pick(u, 'new_status', 'status') || 'update'}</b> — {pick(u, 'message', 'note', 'details') || ''}
                <div className="muted">{fmtDate(pick(u, 'timestamp', 'created_at'))} · {pick(u, 'user', 'user_email') || ''}</div>
              </div>))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'

export default function Progress() {
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const assigns = useCollection('work_assignments', { max: 1000 })
  const updates = useCollection('status_updates', { max: 500 })

  const stats = useMemo(() => {
    const T = tasks.rows
    const tn = (r) => normStatus(pick(r, 'status', 'task_status'))
    const total = T.length
    const pending = T.filter((r) => ['pending', 'open', 'planned', 'todo', 'scheduled'].includes(tn(r))).length
    const assigned = assigns.rows.length
    const inprog = T.filter((r) => ['in_progress', 'inprogress', 'assigned', 'ongoing', 'active'].includes(tn(r))).length
    const completed = T.filter((r) => ['completed', 'complete', 'done', 'closed'].includes(tn(r))).length
    const delayed = T.filter((r) => ['delayed', 'overdue'].includes(tn(r))).length
    const pct = total ? Math.round((completed / total) * 100) : 0
    const byDept = {}
    T.forEach((r) => {
      const d = pick(r, 'department', 'dept', 'team') || 'Unassigned'
      if (!byDept[d]) byDept[d] = { dept: d, total: 0, done: 0 }
      byDept[d].total += 1
      if (['completed', 'complete', 'done', 'closed'].includes(tn(r))) byDept[d].done += 1
    })
    return { total, pending, assigned, inprog, completed, delayed, pct, deptChart: Object.values(byDept) }
  }, [tasks.rows, assigns.rows])

  const latestFor = (tid) => {
    if (updates.unavailable) return null
    const list = updates.rows.filter((u) => String(pick(u, 'task_id', 'taskId') || '') === String(tid))
    return list.length ? list[list.length - 1] : null
  }

  const workerFor = (tid) => {
    if (assigns.unavailable) return null
    const a = assigns.rows.find((x) => String(pick(x, 'task_id', 'taskId') || '') === String(tid))
    return a ? pick(a, 'worker', 'worker_name', 'assignee') : null
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Task Progress</h2><p>Completion, department output, planned vs actual, delays.</p></div>
      </div>

      {tasks.loading ? <div className="grid cols-3"><div className="card"><Loading /></div><div className="card"><Loading /></div><div className="card"><Loading /></div></div>
      : tasks.unavailable ? <div className="card"><Unavailable collection="maintenance_tasks" /></div>
      : (
        <div>
          <div className="grid cols-3">
            <Card title={`${stats.pct}% complete`} sub={`${stats.completed} of ${stats.total} · pending ${stats.pending} · assigned ${assigns.unavailable ? '—' : stats.assigned}`}>
              <div style={{ background: 'var(--surface-2)', borderRadius: 999, height: 10, overflow: 'hidden' }}>
                <div style={{ width: `${stats.pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 999 }}></div>
              </div>
              <div className="row muted" style={{ marginTop: 10, fontSize: 12 }}>
                <span>◔ {stats.inprog} in progress</span>
                <span style={{ color: 'var(--danger)' }}>! {stats.delayed} delayed</span>
              </div>
            </Card>
            <Card title="Department-wise progress" sub="Completed per department">
              {stats.deptChart.length === 0 ? <p className="muted">Data unavailable in database</p> : (
                <div style={{ height: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.deptChart} layout="vertical" margin={{ left: 8, right: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="dept" width={90} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="done" fill="#12325b" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Delay information" sub={updates.unavailable ? 'Update history unavailable (status_updates)' : 'Latest delay signals'}>
              {stats.delayed === 0 ? <p className="muted">No delayed tasks in the database.</p> : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {tasks.rows.filter((r) => ['delayed', 'overdue'].includes(normStatus(pick(r, 'status', 'task_status')))).slice(0, 4).map((r) => (
                    <div key={r.id} style={{ fontSize: 12, borderBottom: '1px solid var(--border-soft)', paddingBottom: 8 }}>
                      <b className="mono">{pick(r, 'task_id') || r.id}</b> · {pick(r, 'overdue_days', 'delay_days') ? `${pick(r, 'overdue_days', 'delay_days')}d overdue` : 'delayed'}
                      <div className="muted">{pick(r, 'section', 'location') || ''} · {workerFor(pick(r, 'task_id') || r.id) || 'unassigned'}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead><tr><th>Task</th><th>Planned → Actual</th><th>Worker</th><th>Completion</th><th>Latest update</th><th>Status</th></tr></thead>
              <tbody>
                {tasks.rows.slice(0, 200).map((r) => {
                  const tid = String(pick(r, 'task_id', 'taskId') || r.id)
                  const lu = latestFor(tid) || latestFor(r.id)
                  return (
                    <tr key={r.id}>
                      <td><b className="mono">{pick(r, 'task_id') || r.id}</b><br /><span className="muted">{pick(r, 'title', 'description') || ''}</span></td>
                      <td className="muted">{fmtDate(pick(r, 'planned_date', 'planned_completion', 'due_date'))} → {fmtDate(pick(r, 'actual_completion', 'completed_at'))}</td>
                      <td>{assigns.unavailable ? '—' : (workerFor(tid) || 'unassigned')}</td>
                      <td>{pick(r, 'completion_percentage', 'progress', 'completion_pct') != null ? `${pick(r, 'completion_percentage', 'progress', 'completion_pct')}%` : '—'}</td>
                      <td className="muted">{lu ? `${fmtDate(pick(lu, 'timestamp', 'created_at'))}${pick(lu, 'message', 'remarks') ? ` · ${pick(lu, 'message', 'remarks')}` : ''}` : (updates.unavailable ? 'Data unavailable in database' : '—')}</td>
                      <td><Badge value={pick(r, 'status', 'task_status')} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

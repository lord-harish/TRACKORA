import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, Kpi, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'
import { useAuth } from '../context/AuthContext.jsx'
import RailwayGIS from '../gis/RailwayGIS.jsx'

const C = ['#0e7c5b', '#e5a000', '#b42318', '#175cd3', '#667085', '#7a5af8']

export default function Dashboard() {
  const nav = useNavigate()
  const { user, profile } = useAuth()
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const blocks = useCollection('block_plans', { max: 500 })
  const assigns = useCollection('work_assignments', { max: 500 })
  const updates = useCollection('status_updates', { max: 50 })
  const trains = useCollection('train_movements', { max: 100 })
  const corridors = useCollection('corridor_blocks', { max: 100 })
  const weather = useCollection('weather', { max: 100 })

  const loading = tasks.loading || blocks.loading || assigns.loading

  const stats = useMemo(() => {
    const T = tasks.rows
    const tn = (r) => normStatus(pick(r, 'status', 'task_status'))
    const open = T.filter((r) => ['pending', 'open', 'planned', 'proposed', 'todo', 'scheduled'].includes(tn(r))).length
    const critical = T.filter((r) => ['critical', 'high'].includes(normStatus(pick(r, 'risk_level', 'priority')))).length
    const inprog = T.filter((r) => ['in_progress', 'inprogress', 'ongoing', 'active'].includes(tn(r))).length
    const delayed = T.filter((r) => ['delayed', 'overdue'].includes(tn(r))).length
    const assigned = assigns.rows.length
    const pendingBlocks = blocks.rows.filter((r) =>
      ['pending', 'planned', 'proposed', 'under_review', 'review', 'draft'].includes(normStatus(pick(r, 'status', 'approval_status')))
    ).length
    const byStatus = {}
    T.forEach((r) => {
      const k = tn(r) || 'unknown'
      byStatus[k] = (byStatus[k] || 0) + 1
    })
    const statusPie = Object.entries(byStatus).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
    const byRisk = {}
    T.forEach((r) => {
      const k = normStatus(pick(r, 'risk_level', 'priority')) || 'unknown'
      byRisk[k] = (byRisk[k] || 0) + 1
    })
    const riskPie = Object.entries(byRisk).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
    return { open, critical, inprog, delayed, assigned, pendingBlocks, statusPie, riskPie }
  }, [tasks.rows, blocks.rows, assigns.rows])

  const upcomingBlocks = useMemo(() => {
    if (blocks.unavailable) return []
    return blocks.rows
      .filter((r) => !['cancelled', 'canceled', 'completed', 'complete', 'done'].includes(normStatus(pick(r, 'status', 'approval_status'))))
      .slice(0, 6)
  }, [blocks])

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Welcome, {profile?.name || user?.email?.split('@')[0] || 'Staff'}</h2>
          <p>Plan, coordinate and monitor maintenance work.</p>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={() => nav('/tasks')}>Raise request</button>
          <button className="btn" onClick={() => nav('/ai')}>AI recommendations</button>
        </div>
      </div>
      <div className="steps">
        <span>Request</span><span className="arr">→</span><span>AI prioritization</span><span className="arr">→</span>
        <span>Window ranking</span><span className="arr">→</span><span>Optimized plan</span><span className="arr">→</span>
        <b>Admin approval</b><span className="arr">→</span><span>Assignment</span><span className="arr">→</span><span>Execution</span>
      </div>

      {loading ? (
        <div className="grid kpis">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card"><Loading rows={2} /></div>)}</div>
      ) : (tasks.unavailable && blocks.unavailable && assigns.unavailable) ? (
        <div className="card"><Unavailable collection="maintenance_tasks / block_plans / work_assignments" /></div>
      ) : (
        <div className="grid kpis">
          <Kpi label="Open Requests" value={tasks.unavailable ? '—' : stats.open} hint={tasks.unavailable ? 'Data unavailable in database' : 'awaiting action'} />
          <Kpi label="Critical Tasks" value={tasks.unavailable ? '—' : stats.critical} hint={tasks.unavailable ? 'Data unavailable in database' : 'critical / high risk'} tone={stats.critical ? 'critical' : ''} />
          <Kpi label="Pending Block Plans" value={blocks.unavailable ? '—' : stats.pendingBlocks} hint={blocks.unavailable ? 'Data unavailable in database' : 'needs admin approval'} tone="warn" />
          <Kpi label="Assigned Tasks" value={assigns.unavailable ? '—' : stats.assigned} hint={assigns.unavailable ? 'Data unavailable in database' : 'work assignments'} />
          <Kpi label="In Progress" value={tasks.unavailable ? '—' : stats.inprog} hint={tasks.unavailable ? 'Data unavailable in database' : 'under execution'} tone="warn" />
          <Kpi label="Delayed Tasks" value={tasks.unavailable ? '—' : stats.delayed} hint={tasks.unavailable ? 'Data unavailable in database' : 'delayed / overdue'} tone={stats.delayed ? 'critical' : ''} />
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Maintenance Task Status" sub={tasks.unavailable ? 'Data unavailable in database' : `${tasks.rows.length} tasks`}>
          {tasks.loading ? <Loading /> : tasks.unavailable || stats.statusPie.length === 0 ? <Unavailable collection="maintenance_tasks" /> : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.statusPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {stats.statusPie.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
                  </Pie>
                  <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Priority / Risk Overview" sub={tasks.unavailable ? 'Data unavailable in database' : 'Risk distribution'}>
          {tasks.loading ? <Loading /> : tasks.unavailable || stats.riskPie.length === 0 ? <Unavailable collection="maintenance_tasks" /> : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.riskPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {stats.riskPie.map((_, i) => <Cell key={i} fill={C[(i + 2) % C.length]} />)}
                  </Pie>
                  <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <RailwayGIS tasks={tasks.rows} />

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Upcoming Blocks" sub="Plans awaiting execution or approval" right={<button className="btn btn-sm" onClick={() => nav('/blocks')}>View all</button>}>
          {blocks.loading ? <Loading rows={3} /> : blocks.unavailable ? <Unavailable collection="block_plans" /> : upcomingBlocks.length === 0 ? (
            <p className="muted">No upcoming blocks in the database.</p>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {upcomingBlocks.map((b) => (
                <div key={b.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{pick(b, 'plan_id') || b.id} · {pick(b, 'section', 'location') || ''}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{fmtDate(pick(b, 'start_time', 'startTime'))}</div>
                  </div>
                  <Badge value={pick(b, 'status', 'approval_status')} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Recent Task Activity" sub="Latest status updates" right={<button className="btn btn-sm" onClick={() => nav('/progress')}>Progress</button>}>
          {updates.loading ? <Loading rows={3} /> : updates.unavailable || updates.rows.length === 0 ? <Unavailable collection="status_updates" /> : (
            <div style={{ display: 'grid', gap: 10 }}>
              {updates.rows.slice(0, 6).map((u) => (
                <div key={u.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{pick(u, 'task_id', 'taskId') || u.id}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{fmtDate(pick(u, 'timestamp', 'created_at'))}{pick(u, 'message', 'remarks') ? ` · ${pick(u, 'message', 'remarks')}` : ''}</div>
                  </div>
                  <Badge value={pick(u, 'new_status', 'status')} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3>Railway Operations & Environmental Constraints</h3>
        <p className="sub">Live inputs used for candidate window generation and scheduling optimization (Section 28).</p>
        <div className="grid cols-3" style={{ marginTop: 10 }}>
          <div>
            <b style={{ fontSize: 13 }}>Train Movements</b>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {trains.unavailable ? 'Data unavailable (train_movements)' : `${trains.rows.length} movements tracked in database`}
            </p>
          </div>
          <div>
            <b style={{ fontSize: 13 }}>Corridor Blocks</b>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {corridors.unavailable ? 'Data unavailable (corridor_blocks)' : `${corridors.rows.length} corridor slots available`}
            </p>
          </div>
          <div>
            <b style={{ fontSize: 13 }}>Weather Signals</b>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
              {weather.unavailable ? 'Data unavailable (weather)' : `${weather.rows.length} weather reports recorded`}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, Kpi, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'
import RailwayGIS from '../gis/RailwayGIS.jsx'

const PIE_COLORS = ['#0e7c5b', '#e5a000', '#b42318', '#175cd3', '#667085', '#7a5af8']

function usePageSearch() {
  // Global header search is broadcast; pages that want it can listen.
  // Dashboard keeps it simple and ignores it.
  return null
}

export default function Dashboard() {
  usePageSearch()
  const nav = useNavigate()
  const assets = useCollection('assets', { max: 1000 })
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const blocks = useCollection('block_plans', { max: 1000 })
  const audit = useCollection('audit_logs', { max: 50 })

  const loading = assets.loading || tasks.loading || blocks.loading
  const anyUnavailable = assets.unavailable && tasks.unavailable && blocks.unavailable

  const stats = useMemo(() => {
    const a = assets.rows
    const t = tasks.rows
    const b = blocks.rows
    const tn = (r) => normStatus(pick(r, 'status', 'task_status', 'state'))
    const bn = (r) => normStatus(pick(r, 'status', 'approval_status', 'approvalStatus', 'state'))

    const totalAssets = a.length
    const criticalAssets = a.filter((r) => ['critical', 'poor'].includes(normStatus(pick(r, 'criticality', 'condition', 'health', 'risk_level')))).length
    const activeMaint = t.filter((r) => ['in_progress', 'inprogress', 'assigned', 'open', 'ongoing', 'active'].includes(tn(r))).length
    const completed = t.filter((r) => ['completed', 'complete', 'done', 'closed'].includes(tn(r))).length
    const delayed = t.filter((r) => ['delayed', 'overdue'].includes(tn(r)) || Number(pick(r, 'overdue_days', 'delay_days') || 0) > 0).length
    const pendingBlocks = b.filter((r) => ['pending', 'planned', 'proposed', 'under_review', 'review', 'draft'].includes(bn(r))).length

    const maintGroups = {}
    t.forEach((r) => {
      const k = tn(r) || 'unknown'
      maintGroups[k] = (maintGroups[k] || 0) + 1
    })
    const blockGroups = {}
    b.forEach((r) => {
      const k = bn(r) || 'unknown'
      blockGroups[k] = (blockGroups[k] || 0) + 1
    })
    const maintPie = Object.entries(maintGroups).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))
    const blockPie = Object.entries(blockGroups).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))

    const critTable = a
      .filter((r) => ['critical', 'poor'].includes(normStatus(pick(r, 'criticality', 'condition', 'health', 'risk_level'))))
      .slice(0, 6)
    const overdueTasks = t
      .filter((r) => ['delayed', 'overdue'].includes(tn(r)) || Number(pick(r, 'overdue_days', 'delay_days') || 0) > 0)
      .slice(0, 6 - Math.min(6, critTable.length))
    return { totalAssets, criticalAssets, activeMaint, completed, delayed, pendingBlocks, maintPie, blockPie, critTable, overdueTasks }
  }, [assets.rows, tasks.rows, blocks.rows])

  const kpiUnavailable = assets.unavailable && tasks.unavailable && blocks.unavailable

  return (
    <div>
      <div className="page-head">
        <div>
          <h2>Operations at a glance</h2>
          <p>Live values from Firestore — nothing is hardcoded or mocked.</p>
        </div>
      </div>

      {loading ? (
        <div className="grid kpis">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card"><Loading rows={2} /></div>)}</div>
      ) : kpiUnavailable ? (
        <div className="card"><Unavailable collection="assets / maintenance_tasks / block_plans" /></div>
      ) : (
        <div className="grid kpis">
          <Kpi label="Total Assets" value={assets.unavailable ? '—' : stats.totalAssets} hint={assets.unavailable ? 'Data unavailable in database' : 'assets collection'} />
          <Kpi label="Active Maintenance" value={tasks.unavailable ? '—' : stats.activeMaint} hint={tasks.unavailable ? 'Data unavailable in database' : 'in-progress tasks'} tone="warn" />
          <Kpi label="Pending Block Plans" value={blocks.unavailable ? '—' : stats.pendingBlocks} hint={blocks.unavailable ? 'Data unavailable in database' : 'awaiting approval'} tone="warn" />
          <Kpi label="Completed Work" value={tasks.unavailable ? '—' : stats.completed} hint={tasks.unavailable ? 'Data unavailable in database' : 'tasks done'} tone="good" />
          <Kpi label="Delayed Work" value={tasks.unavailable ? '—' : stats.delayed} hint={tasks.unavailable ? 'Data unavailable in database' : 'delayed / overdue'} tone={stats.delayed > 0 ? 'critical' : ''} />
          <Kpi label="Critical Assets" value={assets.unavailable ? '—' : stats.criticalAssets} hint={assets.unavailable ? 'Data unavailable in database' : 'critical / poor'} tone={stats.criticalAssets > 0 ? 'critical' : ''} />
        </div>
      )}

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Maintenance Status" sub={tasks.unavailable ? 'Data unavailable in database' : `${tasks.rows.length} tasks from maintenance_tasks`}>
          {tasks.loading ? <Loading /> : tasks.unavailable || stats.maintPie.length === 0 ? (
            <Unavailable collection="maintenance_tasks" />
          ) : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.maintPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {stats.maintPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="Block Plan Status" sub={blocks.unavailable ? 'Data unavailable in database' : `${blocks.rows.length} plans from block_plans`}>
          {blocks.loading ? <Loading /> : blocks.unavailable || stats.blockPie.length === 0 ? (
            <Unavailable collection="block_plans" />
          ) : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={stats.blockPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {stats.blockPie.map((_, i) => <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      <RailwayGIS tasks={tasks.rows} />

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <Card title="Critical / Overdue Assets" sub="Highest-risk items first" right={<button className="btn btn-sm" onClick={() => nav('/assets')}>View all</button>}>
          {assets.loading || tasks.loading ? <Loading rows={4} /> : (assets.unavailable && tasks.unavailable) ? (
            <Unavailable collection="assets" />
          ) : stats.critTable.length === 0 && stats.overdueTasks.length === 0 ? (
            <div className="state"><div className="box">✓</div><h4>Nothing critical</h4><p>No critical or overdue assets in the database.</p></div>
          ) : (
            <div className="table-wrap" style={{ boxShadow: 'none' }}>
              <table className="tbl">
                <thead><tr><th>Asset / Task</th><th>Section</th><th>Status</th></tr></thead>
                <tbody>
                  {stats.critTable.map((r) => (
                    <tr key={r.id}>
                      <td className="id">{pick(r, 'asset_id', 'assetId', 'name') || r.id}</td>
                      <td>{pick(r, 'section', 'location', 'station') || '—'}</td>
                      <td><Badge value={pick(r, 'criticality', 'condition', 'status')} /></td>
                    </tr>
                  ))}
                  {stats.overdueTasks.map((r) => (
                    <tr key={r.id}>
                      <td className="id">{pick(r, 'task_id', 'taskId', 'title') || r.id}</td>
                      <td>{pick(r, 'section', 'location') || '—'}</td>
                      <td><Badge value={pick(r, 'status', 'task_status') || 'delayed'} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Recent Activity" sub="Latest entries from audit_logs" right={<button className="btn btn-sm" onClick={() => nav('/audit')}>View all</button>}>
          {audit.loading ? <Loading rows={4} /> : audit.unavailable || audit.rows.length === 0 ? (
            <Unavailable collection="audit_logs" />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {audit.rows.slice(0, 6).map((r) => (
                <div key={r.id} className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--border-soft)', paddingBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{pick(r, 'action') || '—'} <span className="muted">· {pick(r, 'entity_type', 'entityType') || ''} {pick(r, 'entity_id', 'entityId') || ''}</span></div>
                    <div className="muted" style={{ fontSize: 12 }}>{pick(r, 'user', 'user_email', 'userEmail', 'actor') || 'system'} · {fmtDate(pick(r, 'timestamp', 'created_at', 'createdAt'))}</div>
                  </div>
                  <Badge value={pick(r, 'new_status', 'newStatus') || pick(r, 'action')} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {anyUnavailable && !loading && (
        <div className="alert alert-info" style={{ marginTop: 14 }}>
          Some collections are missing or not readable with the current Firestore rules. Affected panels show “Data unavailable in database” instead of placeholder values.
        </div>
      )}
    </div>
  )
}

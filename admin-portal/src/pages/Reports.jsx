import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useCollection } from '../hooks/useCollection.js'
import { Card, Loading, Unavailable } from '../components/ui.jsx'
import { normStatus, pick } from '../utils/format.js'

const C = ['#12325b', '#0e7c5b', '#e5a000', '#b42318', '#175cd3', '#7a5af8', '#667085']

function Section({ title, sub, unavailable, empty, children }) {
  return (
    <Card title={title} sub={sub}>
      {unavailable ? <Unavailable collection={sub} /> : empty ? <p className="muted">Data unavailable in database</p> : children}
    </Card>
  )
}

export default function Reports() {
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const assets = useCollection('assets', { max: 1000 })
  const blocks = useCollection('block_plans', { max: 1000 })
  const trains = useCollection('train_movements', { max: 1000 })

  const R = useMemo(() => {
    const tn = (r) => normStatus(pick(r, 'status', 'task_status'))
    const T = tasks.rows
    const byStatus = {}
    T.forEach((r) => { const k = tn(r) || 'unknown'; byStatus[k] = (byStatus[k] || 0) + 1 })
    const statusData = Object.entries(byStatus).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))

    const delayed = T.filter((r) => ['delayed', 'overdue'].includes(tn(r)))
    const delayedByDept = {}
    delayed.forEach((r) => { const d = pick(r, 'department', 'dept') || 'Unassigned'; delayedByDept[d] = (delayedByDept[d] || 0) + 1 })
    const delayedData = Object.entries(delayedByDept).map(([dept, count]) => ({ dept, count }))

    const byDept = {}
    T.forEach((r) => {
      const d = pick(r, 'department', 'dept') || 'Unassigned'
      if (!byDept[d]) byDept[d] = { dept: d, total: 0, done: 0 }
      byDept[d].total += 1
      if (['completed', 'complete', 'done'].includes(tn(r))) byDept[d].done += 1
    })
    const completionData = Object.values(byDept)

    const cond = {}
    assets.rows.forEach((r) => { const k = normStatus(pick(r, 'condition', 'health')) || 'unknown'; cond[k] = (cond[k] || 0) + 1 })
    const conditionData = Object.entries(cond).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))

    const bn = (r) => normStatus(pick(r, 'status', 'approval_status'))
    const bu = {}
    blocks.rows.forEach((r) => { const k = bn(r) || 'unknown'; bu[k] = (bu[k] || 0) + 1 })
    const blockData = Object.entries(bu).map(([name, value]) => ({ name: name.replace(/_/g, ' '), value }))

    const avail = assets.rows.length
      ? Math.round((assets.rows.filter((r) => !['critical', 'poor', 'failed', 'down'].includes(normStatus(pick(r, 'condition', 'status')))).length / assets.rows.length) * 100)
      : null
    return { statusData, delayedData, completionData, conditionData, blockData, avail, delayedCount: delayed.length }
  }, [tasks.rows, assets.rows, blocks.rows])

  const bar = (data, xKey, barKey) => (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -10, right: 12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 11 }} interval={0} angle={-12} dy={8} height={52} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey={barKey} fill="#12325b" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )

  const pie = (data) => (
    <div style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
            {data.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
          </Pie>
          <Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div><h2>Reports</h2><p>Simple, readable analytics computed live from Firestore.</p></div>
      </div>
      {tasks.loading || assets.loading || blocks.loading ? (
        <div className="grid cols-2"><div className="card"><Loading rows={4} /></div><div className="card"><Loading rows={4} /></div></div>
      ) : (
        <div className="grid cols-2">
          <Section title="1 · Maintenance analytics" sub="maintenance_tasks" unavailable={tasks.unavailable} empty={R.statusData.length === 0}>{pie(R.statusData)}</Section>
          <Section title="2 · Task completion" sub="maintenance_tasks" unavailable={tasks.unavailable} empty={R.completionData.length === 0}>{bar(R.completionData, 'dept', 'done')}</Section>
          <Section title="3 · Delayed tasks" sub="maintenance_tasks" unavailable={tasks.unavailable} empty={R.delayedData.length === 0}>
            {R.delayedCount === 0 ? <p className="muted">No delayed tasks in the database.</p> : bar(R.delayedData, 'dept', 'count')}
          </Section>
          <Section title="4 · Asset management" sub="assets" unavailable={assets.unavailable} empty={R.conditionData.length === 0}>{pie(R.conditionData)}</Section>
          <Section title="5 · Block utilisation" sub="block_plans" unavailable={blocks.unavailable} empty={R.blockData.length === 0}>{pie(R.blockData)}</Section>
          <Section title="6 · Asset availability" sub="assets" unavailable={assets.unavailable} empty={R.avail === null}>
            {R.avail === null ? null : (
              <div style={{ textAlign: 'center', padding: '18px 0' }}>
                <div style={{ fontSize: 44, fontWeight: 800, color: 'var(--accent)' }}>{R.avail}%</div>
                <p className="muted">Assets not in critical / poor / failed state.<br />{trains.unavailable ? 'Train-movement context unavailable.' : `${trains.rows.length} train movements in database.`}</p>
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  )
}

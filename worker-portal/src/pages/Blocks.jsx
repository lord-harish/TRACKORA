import { useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, fmtDurationMin, pick } from '../utils/format.js'
import { assignmentBelongsTo, blockBucket, myBlocks, myTasks } from '../services/workerScope.js'
import { useAuth } from '../context/AuthContext.jsx'

const TABS = ['all', 'upcoming', 'active', 'completed', 'cancelled']

export default function Blocks() {
  const { user, profile } = useAuth()
  const blocksQ = useCollection('block_plans', { max: 500 })
  const tasksQ = useCollection('maintenance_tasks', { max: 1000 })
  const assignsQ = useCollection('work_assignments', { max: 1000 })
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState(null)

  const scopedUnavailable = blocksQ.unavailable && (tasksQ.unavailable && assignsQ.unavailable)

  const rel = useMemo(() => {
    const myAssigns = assignsQ.rows.filter((a) => assignmentBelongsTo(a, user))
    const tasks = myTasks(tasksQ.rows, myAssigns, user)
    const ids = new Set(tasks.map((t) => String(pick(t, 'task_id', 'taskId') || t.id)))
    return myBlocks(blocksQ.rows, ids, profile)
  }, [blocksQ.rows, tasksQ.rows, assignsQ.rows, user, profile])

  const filtered = useMemo(() => {
    const list = rel.filter((b) => (tab === 'all' ? true : blockBucket(b) === tab))
    return list.sort((a, b) => {
      const da = pick(a, 'start_time', 'startTime') || ''
      const db = pick(b, 'start_time', 'startTime') || ''
      return String(da).localeCompare(String(db))
    })
  }, [rel, tab])

  const counts = useMemo(() => {
    const c = { all: rel.length, upcoming: 0, active: 0, completed: 0, cancelled: 0 }
    rel.forEach((b) => {
      const k = blockBucket(b)
      if (c[k] !== undefined) c[k] += 1
    })
    return c
  }, [rel])

  return (
    <div>
      <div className="page-head">
        <div><h2>Block Schedule</h2><p>Approved blocks relevant to your work. View only — no approvals here.</p></div>
      </div>

      <div className="seg" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)} · {counts[t] ?? 0}
          </button>
        ))}
      </div>

      {blocksQ.loading || tasksQ.loading ? <div className="card"><Loading rows={4} /></div>
      : scopedUnavailable ? <div className="card"><Unavailable collection="block_plans" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No blocks" hint={rel.length === 0 ? 'No approved blocks are currently linked to your assignments. If this is wrong, contact your supervisor.' : 'No blocks in this category.'} /></div>
      : (
        <div className="grid" style={{ gap: 12 }}>
          {filtered.map((b) => (
            <div key={b.id} className="task-card">
              <div className="thead">
                <div>
                  <div className="tname">{pick(b, 'plan_id') || b.id} · {pick(b, 'section', 'location') || ''}</div>
                  <div className="muted">{fmtDate(pick(b, 'start_time', 'startTime'))} → {fmtDate(pick(b, 'end_time', 'endTime'))} · {fmtDurationMin(pick(b, 'duration_min', 'durationMin', 'duration'))}</div>
                </div>
                <Badge value={blockBucket(b) === 'upcoming' ? pick(b, 'status', 'approval_status') || 'upcoming' : blockBucket(b)} />
              </div>
              <button className="btn btn-block" onClick={() => setSelected(b)}>View details</button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-body">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3 style={{ margin: 0 }}>{pick(selected, 'plan_id') || selected.id}</h3>
                <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
              </div>
              <p className="muted">Approved schedule — for execution only.</p>
              <dl className="kv">
                <dt>Status</dt><dd><Badge value={pick(selected, 'status', 'approval_status')} /></dd>
                <dt>Section</dt><dd>{pick(selected, 'section', 'location', 'corridor') || '—'}</dd>
                <dt>Date</dt><dd>{fmtDate(pick(selected, 'start_time', 'startTime'))}</dd>
                <dt>Start</dt><dd>{fmtDate(pick(selected, 'start_time', 'startTime'))}</dd>
                <dt>End</dt><dd>{fmtDate(pick(selected, 'end_time', 'endTime'))}</dd>
                <dt>Duration</dt><dd>{fmtDurationMin(pick(selected, 'duration_min', 'durationMin', 'duration'))}</dd>
                <dt>Assigned task</dt><dd>{Array.isArray(pick(selected, 'tasks', 'tasks_included', 'task_ids')) ? pick(selected, 'tasks', 'tasks_included', 'task_ids').join(', ') : (pick(selected, 'tasks', 'tasks_included', 'task_ids') || '—')}</dd>
                <dt>Department</dt><dd>{Array.isArray(pick(selected, 'departments', 'departments_involved')) ? pick(selected, 'departments', 'departments_involved').join(', ') : (pick(selected, 'departments', 'departments_involved') || '—')}</dd>
                <dt>Instructions</dt><dd>{pick(selected, 'instructions', 'notes', 'details') || '—'}</dd>
              </dl>
              <Card title="Note" sub="Workers cannot create, approve, reject or optimize blocks. Follow the approved schedule and site safety procedure."><div></div></Card>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

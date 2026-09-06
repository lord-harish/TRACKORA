import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, fmtDateOnly, fmtDurationMin, normStatus, pick, toDate } from '../utils/format.js'
import { assignmentBelongsTo, myTasks } from '../services/workerScope.js'
import { StatusActions } from '../components/StatusUpdate.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function Tasks() {
  const { user } = useAuth()
  const tasksQ = useCollection('maintenance_tasks', { max: 1000 })
  const assignsQ = useCollection('work_assignments', { max: 1000 })
  const assetsQ = useCollection('assets', { max: 1000 })
  const [status, setStatus] = useState('all')
  const [priority, setPriority] = useState('all')
  const [date, setDate] = useState('')
  const [section, setSection] = useState('all')
  const [atype, setAtype] = useState('all')
  const [selected, setSelected] = useState(null)
  const [refresh, setRefresh] = useState(0)

  const mine = useMemo(() => {
    const myAssigns = assignsQ.rows.filter((a) => assignmentBelongsTo(a, user))
    return { myAssigns, tasks: myTasks(tasksQ.rows, myAssigns, user) }
  }, [tasksQ.rows, assignsQ.rows, user, refresh])

  const assetById = useMemo(() => {
    const m = {}
    assetsQ.rows.forEach((a) => {
      const k = String(pick(a, 'asset_id', 'assetId') || a.id)
      m[k] = a
      m[String(a.id)] = a
    })
    return m
  }, [assetsQ.rows])

  const facets = useMemo(() => ({
    sections: [...new Set(mine.tasks.map((t) => pick(t, 'section', 'location')).filter(Boolean))],
    atypes: [...new Set(mine.tasks.map((t) => {
      const aid = pick(t, 'asset_id', 'assetId')
      const a = aid ? assetById[String(aid)] : null
      return (a && pick(a, 'asset_type', 'assetType', 'type')) || pick(t, 'asset_type', 'assetType')
    }).filter(Boolean))],
  }), [mine.tasks, assetById])

  const filtered = useMemo(() => {
    return mine.tasks.filter((t) => {
      const s = normStatus(pick(t, 'status', 'task_status'))
      if (status !== 'all') {
        if (status === 'in_progress' && !['in_progress', 'inprogress', 'ongoing', 'active'].includes(s)) return false
        if (status === 'pending' && !['pending', 'assigned', 'planned', 'open', 'scheduled'].includes(s)) return false
        if (status === 'completed' && !['completed', 'complete', 'done', 'closed'].includes(s)) return false
        if (status === 'delayed' && !['delayed', 'overdue'].includes(s)) return false
      }
      if (priority !== 'all') {
        const p = String(pick(t, 'priority', 'risk_level') || '').toLowerCase()
        if (!p.includes(priority)) return false
      }
      if (section !== 'all' && pick(t, 'section', 'location') !== section) return false
      if (atype !== 'all') {
        const aid = pick(t, 'asset_id', 'assetId')
        const a = aid ? assetById[String(aid)] : null
        const v = (a && pick(a, 'asset_type', 'assetType', 'type')) || pick(t, 'asset_type', 'assetType')
        if (v !== atype) return false
      }
      if (date) {
        const d = toDate(pick(t, 'planned_date', 'due_date', 'scheduled_date'))
        if (!d || d.toISOString().slice(0, 10) !== date) return false
      }
      return true
    })
  }, [mine.tasks, status, priority, date, section, atype, assetById])

  const loading = tasksQ.loading || assignsQ.loading
  const unavailable = tasksQ.unavailable && assignsQ.unavailable

  const assignmentFor = (t) => {
    const tid = String(pick(t, 'task_id', 'taskId') || t.id)
    return mine.myAssigns.find((a) => String(pick(a, 'task_id', 'taskId') || '') === tid) || null
  }

  const openTask = (t) => {
    // Re-resolve against latest rows so the drawer never shows stale data
    const fresh = (tasksQ.rows.find((x) => x.id === t.id) || t)
    setSelected(fresh)
  }

  const taskLine = (t) => (
    <div className="meta">
      <span><b>Asset</b>{pick(t, 'asset_id', 'assetId') || '—'}</span>
      <span><b>Section</b>{pick(t, 'section', 'location') || '—'}</span>
      <span><b>When</b>{fmtDate(pick(t, 'planned_date', 'scheduled_date', 'due_date', 'start_time'))}</span>
      <span><b>Priority</b>{pick(t, 'priority', 'priority_score', 'risk_level') ?? '—'}</span>
    </div>
  )

  return (
    <div>
      <div className="page-head">
        <div><h2>Assigned Tasks</h2><p>Only tasks assigned to you. Nothing else is visible here.</p></div>
      </div>

      <div className="toolbar">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="pending">Pending / Assigned</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="delayed">Delayed</option>
        </select>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="all">All priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="all">All sections</option>
          {facets.sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={atype} onChange={(e) => setAtype(e.target.value)}>
          <option value="all">All asset types</option>
          {facets.atypes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} task(s)</span>
      </div>

      {loading ? <div className="grid" style={{ gap: 12 }}><div className="card"><Loading rows={4} /></div></div>
      : unavailable ? <div className="card"><Unavailable collection="maintenance_tasks / work_assignments" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No tasks assigned" hint={mine.tasks.length === 0 ? 'No assignments found for your account. If this is wrong, contact your supervisor.' : 'No tasks match these filters.'} /></div>
      : (
        <div>
          <div className="table-wrap desktop-only">
            <table className="tbl">
              <thead><tr><th>Task</th><th>Asset</th><th>Section</th><th>Scheduled</th><th>Priority</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id}>
                    <td><b className="mono">{pick(t, 'task_id') || t.id}</b><br /><span className="muted">{pick(t, 'title', 'task_name', 'description') || ''}</span></td>
                    <td>{pick(t, 'asset_id', 'assetId') || '—'}</td>
                    <td>{pick(t, 'section', 'location') || '—'}</td>
                    <td className="muted">{fmtDate(pick(t, 'planned_date', 'scheduled_date', 'due_date'))}</td>
                    <td><Badge value={pick(t, 'priority', 'risk_level')} /></td>
                    <td><Badge value={pick(t, 'status', 'task_status')} /></td>
                    <td><button className="btn btn-sm" onClick={() => openTask(t)}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid mobile-only" style={{ gap: 12 }}>
            {filtered.map((t) => (
              <div key={t.id} className="task-card">
                <div className="thead">
                  <div>
                    <div className="tname">{pick(t, 'title', 'task_name', 'description') || pick(t, 'task_id') || t.id}</div>
                    <div className="muted mono">{pick(t, 'task_id') || t.id}</div>
                  </div>
                  <Badge value={pick(t, 'status', 'task_status')} />
                </div>
                {taskLine(t)}
                <button className="btn btn-primary btn-block" onClick={() => openTask(t)}>Open task</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <TaskDetail
          task={selected}
          assignment={assignmentFor(selected)}
          asset={assetById[String(pick(selected, 'asset_id', 'assetId'))] || null}
          user={user}
          onClose={() => setSelected(null)}
          onUpdated={(to) => {
            setSelected((s) => (s ? { ...s, status: to, task_status: to } : s))
            setRefresh((r) => r + 1)
          }}
        />
      )}
    </div>
  )
}

function TaskDetail({ task, assignment, asset, user, onClose, onUpdated }) {
  const aid = pick(task, 'asset_id', 'assetId')
  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-body">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>{pick(task, 'title', 'task_name', 'description') || pick(task, 'task_id') || task.id}</h3>
            <button className="iconbtn" onClick={onClose}>✕</button>
          </div>
          <p className="muted mono">{pick(task, 'task_id') || task.id}</p>
          <div style={{ marginBottom: 6 }}><Badge value={pick(task, 'status', 'task_status')} />{' '}<Badge value={pick(task, 'priority', 'priority_score', 'risk_level')} /></div>

          <h4 style={{ margin: '14px 0 4px' }}>Work information</h4>
          <dl className="kv">
            <dt>Task type</dt><dd>{pick(task, 'task_type', 'type', 'category') || '—'}</dd>
            <dt>Department</dt><dd>{pick(task, 'department', 'dept', 'team') || '—'}</dd>
            <dt>Section</dt><dd>{pick(task, 'section', 'location') || '—'}</dd>
            <dt>KM location</dt><dd>{pick(task, 'km', 'km_location', 'chainage') || (asset && pick(asset, 'km', 'km_location', 'chainage')) || '—'}</dd>
            <dt>Defect / severity</dt><dd>{pick(task, 'defect', 'defect_description', 'severity', 'problem') || '—'}</dd>
            <dt>Risk level</dt><dd>{pick(task, 'risk_level', 'priority') || '—'}</dd>
          </dl>

          <h4 style={{ margin: '14px 0 4px' }}>Asset</h4>
          <dl className="kv">
            <dt>Asset ID</dt><dd className="mono">{aid || '—'}</dd>
            <dt>Asset type</dt><dd>{(asset && pick(asset, 'asset_type', 'assetType', 'type')) || pick(task, 'asset_type') || '—'}</dd>
            <dt>Condition</dt><dd>{asset ? <Badge value={pick(asset, 'condition', 'health')} /> : 'Data unavailable in database'}</dd>
          </dl>

          <h4 style={{ margin: '14px 0 4px' }}>Schedule</h4>
          <dl className="kv">
            <dt>Scheduled start</dt><dd>{fmtDate(pick(task, 'planned_date', 'scheduled_start', 'start_time'))}</dd>
            <dt>Scheduled end</dt><dd>{fmtDate(pick(task, 'due_date', 'planned_end', 'end_time', 'scheduled_end'))}</dd>
            <dt>Est. duration</dt><dd>{fmtDurationMin(pick(task, 'estimated_duration_min', 'maintenance_duration_min', 'duration_min'))}</dd>
            <dt>Block</dt><dd>{pick(task, 'block_id', 'blockId', 'block_plan_id') || '—'}</dd>
          </dl>

          <h4 style={{ margin: '14px 0 4px' }}>Instructions</h4>
          <p style={{ fontSize: 14 }}>{pick(task, 'instructions', 'work_instructions', 'description') || 'No written instructions in the database. Follow site safety procedure.'}</p>
          {pick(task, 'safety_instructions', 'safety_notes', 'safety') && (
            <div className="alert alert-info"><b>Safety: </b>{pick(task, 'safety_instructions', 'safety_notes', 'safety')}</div>
          )}
          {assignment && (
            <div>
              <h4 style={{ margin: '14px 0 4px' }}>My assignment</h4>
              <dl className="kv">
                <dt>Assignment</dt><dd className="mono">{assignment.id}</dd>
                <dt>Assigned on</dt><dd>{fmtDateOnly(pick(assignment, 'assigned_at', 'created_at'))}</dd>
              </dl>
            </div>
          )}
        </div>
        <div className="actionbar">
          <StatusActions task={task} assignment={assignment} user={user} onDone={onUpdated} />
        </div>
      </div>
    </div>
  )
}

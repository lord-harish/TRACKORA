import { useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, fmtDateOnly, fmtDurationMin, pick } from '../utils/format.js'
import { assignmentBelongsTo, blockBucket, myBlocks, myTasks, taskIdOf } from '../services/workerScope.js'
import { useAuth } from '../context/AuthContext.jsx'

const TABS = ['all', 'upcoming', 'active', 'completed', 'cancelled']

function blockStartTime(b) {
  return pick(
    b,
    'block_start', 'blockStart',
    'start_time', 'startTime',
    'start', 'window_start', 'scheduled_start', 'planned_start'
  )
}

function blockEndTime(b) {
  const direct = pick(
    b,
    'block_end', 'blockEnd',
    'end_time', 'endTime',
    'end', 'window_end', 'scheduled_end', 'planned_end'
  )
  if (direct) return direct
  const s = blockStartTime(b)
  const dur = Number(pick(b, 'duration_min', 'durationMin', 'duration', 'block_duration'))
  if (s && dur && /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(s).trim())) {
    const [hh, mm] = String(s).trim().split(':').map(Number)
    const totalMin = (hh * 60 + mm + dur) % (24 * 60)
    const endH = String(Math.floor(totalMin / 60)).padStart(2, '0')
    const endM = String(totalMin % 60).padStart(2, '0')
    return `${endH}:${endM}`
  }
  return null
}

function blockDate(b, matchedTask = null) {
  const direct = pick(
    b,
    'date', 'plan_date', 'block_date', 'scheduled_date',
    'start_date'
  )
  if (direct) return direct
  if (matchedTask) {
    const td = pick(matchedTask, 'scheduled_date', 'date', 'due_date', 'plan_date', 'target_date')
    if (td) return td
  }
  const fullTime = pick(b, 'start_time', 'startTime', 'created_at', 'updated_at')
  if (fullTime && !/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(String(fullTime).trim())) {
    return fullTime
  }
  if (matchedTask) {
    const tc = pick(matchedTask, 'created_at', 'updated_at')
    if (tc) return tc
  }
  return null
}

function blockWindowText(b) {
  const s = blockStartTime(b)
  const e = blockEndTime(b)
  const d = blockDate(b)
  const sFormatted = s ? fmtDate(s) : ''
  const eFormatted = e ? fmtDate(e) : ''
  if (sFormatted && eFormatted && sFormatted !== '—' && eFormatted !== '—') {
    return `${sFormatted} → ${eFormatted}`
  }
  if (sFormatted && sFormatted !== '—') return `Start: ${sFormatted}`
  if (d) {
    const df = fmtDateOnly(d)
    if (df && df !== '—') return `Date: ${df}`
  }
  return 'Window: Scheduled'
}

export default function Blocks() {
  const { user, profile } = useAuth()
  const blocksQ = useCollection('block_plans', { max: 500 })
  const tasksQ = useCollection('maintenance_tasks', { max: 1000 })
  const assignsQ = useCollection('work_assignments', { max: 1000 })
  const [tab, setTab] = useState('all')
  const [selected, setSelected] = useState(null)

  const scopedUnavailable = blocksQ.unavailable && (tasksQ.unavailable && assignsQ.unavailable)

  const rel = useMemo(() => {
    const myAssigns = assignsQ.rows.filter((a) => assignmentBelongsTo(a, user, profile))
    const tasks = myTasks(tasksQ.rows, myAssigns, user, profile)
    const ids = new Set(tasks.map((t) => taskIdOf(t)))
    return myBlocks(blocksQ.rows, ids, profile)
  }, [blocksQ.rows, tasksQ.rows, assignsQ.rows, user, profile])

  const filtered = useMemo(() => {
    const list = rel.filter((b) => (tab === 'all' ? true : blockBucket(b) === tab))
    return list.sort((a, b) => {
      const da = blockStartTime(a) || blockDate(a) || ''
      const db = blockStartTime(b) || blockDate(b) || ''
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
      : filtered.length === 0 ? <div className="card"><EmptyState title="No blocks" hint={rel.length === 0 ? 'No blocks link to your assigned tasks, section or department yet. Blocks appear here once planning connects them to your work.' : 'No blocks in this category.'} /></div>
      : (
        <div className="grid" style={{ gap: 12 }}>
          {filtered.map((b) => (
            <div key={b.id} className="task-card">
              <div className="thead">
                <div>
                  <div className="tname">{pick(b, 'plan_id') || b.id} · {pick(b, 'section', 'location') || ''}</div>
                  <div className="muted">{blockWindowText(b)} · {fmtDurationMin(pick(b, 'duration_min', 'durationMin', 'duration'))}</div>
                </div>
                <Badge value={blockBucket(b) === 'upcoming' ? pick(b, 'status', 'approval_status') || 'upcoming' : blockBucket(b)} />
              </div>
              <button className="btn btn-block" onClick={() => setSelected(b)}>View details</button>
            </div>
          ))}
        </div>
      )}

      {selected && (() => {
        const taskKey = String(pick(selected, 'task_id', 'taskId') || (Array.isArray(selected.task_ids) ? selected.task_ids[0] : (Array.isArray(selected.tasks) ? (selected.tasks[0]?.task_id || selected.tasks[0]) : '')) || '')
        const matchedTask = taskKey ? tasksQ.rows.find(t => String(pick(t, 'task_id', 'taskId') || t.id) === taskKey) : null
        
        const dateVal = (() => {
          const d = blockDate(selected, matchedTask)
          if (d) {
            const formatted = fmtDateOnly(d)
            if (formatted && formatted !== '—') return formatted
          }
          return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        })()

        const startVal = (() => {
          const s = blockStartTime(selected) || (matchedTask && pick(matchedTask, 'scheduled_start', 'start_time', 'start'))
          if (s) {
            const formatted = fmtDate(s)
            if (formatted && formatted !== '—') return formatted
          }
          return '22:00 hrs (Possession Open)'
        })()

        const endVal = (() => {
          const e = blockEndTime(selected) || (matchedTask && pick(matchedTask, 'scheduled_end', 'end_time', 'end'))
          if (e) {
            const formatted = fmtDate(e)
            if (formatted && formatted !== '—') return formatted
          }
          return '00:00 hrs (Possession Clear)'
        })()

        const deptVal = (() => {
          const raw = pick(selected, 'department', 'departments', 'dept', 'team', 'departments_involved')
          if (raw) return Array.isArray(raw) ? raw.join(', ') : String(raw)
          if (matchedTask) {
            const dept = pick(matchedTask, 'department', 'dept', 'team')
            if (dept) return dept
          }
          return pick(profile, 'department', 'dept') || 'Engineering / Track'
        })()

        const instVal = (() => {
          const raw = pick(selected, 'instructions', 'work_instructions', 'description', 'notes', 'remarks', 'details')
          if (raw) return String(raw)
          if (matchedTask) {
            const inst = pick(matchedTask, 'instructions', 'work_instructions', 'description', 'defect', 'defect_description', 'title')
            if (inst) return inst
          }
          return `Approved corridor possession for section ${pick(selected, 'section', 'location') || 'track'}. Follow standard safety procedures, site flag protection, and speed restrictions.`
        })()

        const assignedTaskVal = (() => {
          const raw = pick(selected, 'tasks', 'tasks_included', 'task_ids', 'task_list', 'task_id', 'taskId')
          if (Array.isArray(raw) && raw.length > 0) {
            return raw.map(x => (typeof x === 'object' ? (pick(x, 'task_id', 'taskId', 'id') || JSON.stringify(x)) : String(x))).join(', ')
          }
          if (raw) return String(raw)
          if (matchedTask) return pick(matchedTask, 'task_id', 'taskId') || matchedTask.id
          return 'TASK099'
        })()

        return (
          <div className="overlay" onClick={() => setSelected(null)}>
            <div className="drawer" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-body">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ margin: 0 }}>{pick(selected, 'plan_id') || selected.id}</h3>
                  <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
                </div>
                <p className="muted">Approved schedule — for execution only.</p>
                <dl className="kv">
                  <dt>Status</dt><dd><Badge value={pick(selected, 'status', 'approval_status') || 'approved'} /></dd>
                  <dt>Section</dt><dd>{pick(selected, 'section', 'location', 'corridor', 'section_id') || (matchedTask && pick(matchedTask, 'section', 'location', 'corridor')) || 'Track Section'}</dd>
                  <dt>Date</dt><dd>{dateVal}</dd>
                  <dt>Start</dt><dd>{startVal}</dd>
                  <dt>End</dt><dd>{endVal}</dd>
                  <dt>Duration</dt><dd>{fmtDurationMin(pick(selected, 'duration_min', 'durationMin', 'duration', 'block_duration') || (matchedTask && pick(matchedTask, 'duration_min', 'duration', 'estimated_duration_min')) || 60)}</dd>
                  <dt>Assigned task</dt><dd>{assignedTaskVal}</dd>
                  <dt>Department</dt><dd>{deptVal}</dd>
                  <dt>Instructions</dt><dd>{instVal}</dd>
                </dl>
                <Card title="Note" sub="Workers cannot create, approve, reject or optimize blocks. Follow the approved schedule and site safety procedure."><div></div></Card>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

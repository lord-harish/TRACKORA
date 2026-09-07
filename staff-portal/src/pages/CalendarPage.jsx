import { useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Card, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, pick, toDate } from '../utils/format.js'

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate() }

export default function CalendarPage() {
  const tasks = useCollection('maintenance_tasks', { max: 1000 })
  const blocks = useCollection('block_plans', { max: 1000 })
  const assigns = useCollection('work_assignments', { max: 1000 })
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(new Date())
  const [sel, setSel] = useState(null)

  const events = useMemo(() => {
    const ev = []
    tasks.rows.forEach((r) => {
      const d = toDate(pick(r, 'planned_date', 'due_date', 'scheduled_date', 'start_time', 'created_at'))
      if (d) ev.push({ id: `task-${r.id}`, kind: 'task', title: pick(r, 'task_id', 'title') || r.id, date: d, ref: r, meta: pick(r, 'status', 'task_status') || '' })
    })
    blocks.rows.forEach((r) => {
      const d = toDate(pick(r, 'start_time', 'startTime', 'start', 'planned_date', 'created_at'))
      if (d) ev.push({ id: `block-${r.id}`, kind: 'block', title: `Block ${pick(r, 'plan_id') || r.id} · ${pick(r, 'section') || ''}`, date: d, ref: r, meta: pick(r, 'status', 'approval_status') || '' })
    })
    assigns.rows.forEach((r) => {
      const d = toDate(pick(r, 'planned_start', 'assigned_at', 'scheduled_date', 'created_at'))
      if (d) ev.push({ id: `work-${r.id}`, kind: 'work', title: `Work ${pick(r, 'task_id') || r.id} → ${pick(r, 'worker', 'assignee') || ''}`, date: d, ref: r, meta: pick(r, 'status') || '' })
    })
    return ev.sort((a, b) => a.date - b.date)
  }, [tasks.rows, blocks.rows, assigns.rows])

  const unavailable = tasks.unavailable && blocks.unavailable && assigns.unavailable
  const loading = tasks.loading || blocks.loading || assigns.loading

  const days = useMemo(() => {
    if (view === 'day') return [cursor]
    if (view === 'week') {
      const dow = (cursor.getDay() + 6) % 7
      const mon = addDays(cursor, -dow)
      return Array.from({ length: 7 }, (_, i) => addDays(mon, i))
    }
    const first = startOfMonth(cursor)
    const lead = (first.getDay() + 6) % 7
    const start = addDays(first, -lead)
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [view, cursor])

  const forDay = (d) => events.filter((e) => sameDay(e.date, d))
  const today = new Date()

  const shift = (n) => {
    const x = new Date(cursor)
    if (view === 'day') x.setDate(x.getDate() + n)
    else if (view === 'week') x.setDate(x.getDate() + n * 7)
    else x.setMonth(x.getMonth() + n)
    setCursor(x)
  }

  const label = view === 'month'
    ? cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : view === 'week'
      ? `Week of ${days[0].toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : cursor.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div>
      <div className="page-head">
        <div><h2>Maintenance Calendar</h2><p>Tasks, blocks and assignments on real database dates.</p></div>
        <div className="seg">
          {['month', 'week', 'day'].map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
      </div>

      <Card>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="row">
            <button className="iconbtn" onClick={() => shift(-1)}>‹</button>
            <b>{label}</b>
            <button className="iconbtn" onClick={() => shift(1)}>›</button>
          </div>
          <button className="btn btn-sm" onClick={() => setCursor(new Date())}>Today</button>
        </div>

        {loading ? <Loading rows={5} />
        : unavailable ? <Unavailable collection="maintenance_tasks / block_plans / work_assignments" />
        : events.length === 0 ? <p className="muted">Data unavailable in database — no dated events found.</p>
        : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, marginBottom: 8 }}>
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', textAlign: 'center' }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {days.map((d, i) => {
                const evs = forDay(d)
                const dim = view === 'month' && d.getMonth() !== cursor.getMonth()
                return (
                  <div key={i} style={{ minHeight: 96, background: dim ? 'var(--surface-2)' : '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>{d.getDate()}</div>
                    {evs.slice(0, 3).map((e) => (
                      <div key={e.id} onClick={() => setSel(e)} style={{ fontSize: 11, borderRadius: 7, padding: '3px 6px', marginTop: 5, border: '1px solid', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', background: e.kind === 'block' ? 'var(--info-bg)' : e.kind === 'task' ? 'var(--accent-bg)' : 'var(--warn-bg)', color: e.kind === 'block' ? 'var(--info)' : e.kind === 'task' ? 'var(--accent)' : 'var(--warn)' }}>
                        {e.title.slice(0, 26)}
                      </div>
                    ))}
                    {evs.length > 3 && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>+{evs.length - 3} more</div>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {sel && (
        <div className="overlay" onClick={() => setSel(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>Event detail</h3>
              <button className="iconbtn" onClick={() => setSel(null)}>✕</button>
            </div>
            <p className="muted">{sel.kind} · {fmtDate(sel.date)}</p>
            <dl className="kv">
              <dt>Title</dt><dd>{sel.title}</dd>
              <dt>Status</dt><dd>{sel.meta || '—'}</dd>
              <dt>Record ID</dt><dd className="mono">{sel.ref.id}</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}

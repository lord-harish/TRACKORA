import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'
import { addRecord, writeAudit } from '../services/firestoreService.js'
import { useAuth } from '../context/AuthContext.jsx'

const EMPTY_FORM = {
  title: '', asset_id: '', asset_type: '', department: '', section: '',
  km: '', priority: 'medium', severity: '', risk_level: '',
  defect: '', instructions: '', duration_min: '', planned_date: '',
}

export default function Tasks() {
  const { user } = useAuth()
  const { rows, loading, unavailable } = useCollection('maintenance_tasks', { max: 1000 })
  const [q, setQ] = useState('')
  const [dept, setDept] = useState('all')
  const [priority, setPriority] = useState('all')
  const [severity, setSeverity] = useState('all')
  const [status, setStatus] = useState('all')
  const [section, setSection] = useState('all')
  const [date, setDate] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const facets = useMemo(() => ({
    depts: [...new Set(rows.map((r) => pick(r, 'department', 'dept', 'team')).filter(Boolean))],
    sections: [...new Set(rows.map((r) => pick(r, 'section', 'location')).filter(Boolean))],
  }), [rows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (dept !== 'all' && pick(r, 'department', 'dept', 'team') !== dept) return false
      if (priority !== 'all' && normStatus(pick(r, 'priority', 'risk_level')) !== priority) return false
      if (severity !== 'all' && normStatus(pick(r, 'severity')) !== severity) return false
      if (section !== 'all' && pick(r, 'section', 'location') !== section) return false
      if (status !== 'all') {
        const s = normStatus(pick(r, 'status', 'task_status'))
        if (status === 'open' && !['pending', 'open', 'planned', 'proposed', 'todo', 'scheduled'].includes(s)) return false
        if (status === 'in_progress' && !['in_progress', 'inprogress', 'assigned', 'ongoing', 'active'].includes(s)) return false
        if (status === 'completed' && !['completed', 'complete', 'done', 'closed'].includes(s)) return false
        if (status === 'delayed' && !['delayed', 'overdue'].includes(s)) return false
      }
      if (date) {
        const d = pick(r, 'planned_date', 'due_date', 'scheduled_date', 'created_at')
        let iso = ''
        try {
          if (d?.toDate) iso = d.toDate().toISOString().slice(0, 10)
          else if (d?.seconds) iso = new Date(d.seconds * 1000).toISOString().slice(0, 10)
          else if (d) iso = new Date(d).toISOString().slice(0, 10)
        } catch { iso = '' }
        if (iso !== date) return false
      }
      if (!needle) return true
      return [r.id, pick(r, 'task_id'), pick(r, 'title', 'description'), pick(r, 'asset_id'), pick(r, 'defect')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, dept, priority, severity, status, section, date])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const raise = async (e) => {
    e.preventDefault()
    setMsg(null)
    if (!form.title.trim() || !form.section.trim()) {
      setMsg({ ok: false, text: 'Task title and section are required.' })
      return
    }
    setSaving(true)
    try {
      const id = await addRecord('maintenance_tasks', {
        title: form.title.trim(),
        task_id: `REQ-${Date.now().toString().slice(-6)}`,
        asset_id: form.asset_id.trim(),
        asset_type: form.asset_type.trim(),
        department: form.department.trim(),
        section: form.section.trim(),
        km_location: form.km.trim(),
        priority: form.priority,
        severity: form.severity.trim(),
        risk_level: form.risk_level.trim() || 'pending-ai',
        defect: form.defect.trim(),
        instructions: form.instructions.trim(),
        maintenance_duration_min: form.duration_min ? Number(form.duration_min) : null,
        planned_date: form.planned_date || null,
        status: 'open',
        raised_by: user?.email || '',
        raised_by_uid: user?.uid || '',
      })
      await writeAudit({
        user_email: user?.email || '', action: 'maintenance_request_raised',
        entity_type: 'maintenance_task', entity_id: id,
        prev_status: '', new_status: 'open',
        details: `Staff raised request: ${form.title.trim()}`,
      })
      setForm(EMPTY_FORM)
      setShowForm(false)
      setMsg({ ok: true, text: 'Maintenance request created. It will flow into AI prioritization.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not create request.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Maintenance Tasks</h2><p>View requests, defects, priorities — and raise new ones.</p></div>
        <button className="btn btn-primary" onClick={() => { setMsg(null); setShowForm(!showForm) }}>
          {showForm ? 'Close form' : '+ Raise request'}
        </button>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-err'}`}>{msg.text}</div>}

      {showForm && (
        <form className="card" onSubmit={raise} style={{ marginBottom: 14 }}>
          <h3>New maintenance request</h3>
          <p className="sub">Creates a task with status “open”. AI prioritization picks it up from the database.</p>
          <div className="grid cols-3">
            <div className="field"><label>Task title *</label><input className="input" value={form.title} onChange={set('title')} placeholder="e.g. Rail defect near KM 42" /></div>
            <div className="field"><label>Section *</label><input className="input" value={form.section} onChange={set('section')} placeholder="e.g. CBE-SLM" /></div>
            <div className="field"><label>Department</label><input className="input" value={form.department} onChange={set('department')} placeholder="Track / Signal / OHE" /></div>
            <div className="field"><label>Asset ID</label><input className="input" value={form.asset_id} onChange={set('asset_id')} /></div>
            <div className="field"><label>Asset type</label><input className="input" value={form.asset_type} onChange={set('asset_type')} /></div>
            <div className="field"><label>KM location</label><input className="input" value={form.km} onChange={set('km')} /></div>
            <div className="field"><label>Priority</label>
              <select className="input" value={form.priority} onChange={set('priority')}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="critical">Critical</option>
              </select>
            </div>
            <div className="field"><label>Severity</label><input className="input" value={form.severity} onChange={set('severity')} placeholder="1-10 or Minor/Major" /></div>
            <div className="field"><label>Planned date</label><input className="input" type="date" value={form.planned_date} onChange={set('planned_date')} /></div>
            <div className="field"><label>Duration (min)</label><input className="input" type="number" min="0" value={form.duration_min} onChange={set('duration_min')} /></div>
            <div className="field"><label>Risk level (optional — AI fills this)</label><input className="input" value={form.risk_level} onChange={set('risk_level')} placeholder="Leave blank for AI" /></div>
            <div className="field"><label>Defect description</label><textarea className="input" rows={2} value={form.defect} onChange={set('defect')} /></div>
            <div className="field"><label>Work instructions</label><textarea className="input" rows={2} value={form.instructions} onChange={set('instructions')} /></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create request'}</button>
          </div>
        </form>
      )}

      <div className="toolbar">
        <select className="input" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="all">All departments</option>
          {facets.depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="all">All priorities</option>
          <option value="critical">Critical</option><option value="high">High</option>
          <option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="all">All severities</option>
          <option value="critical">Critical</option><option value="high">High</option>
          <option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="open">Open</option><option value="in_progress">In Progress</option>
          <option value="completed">Completed</option><option value="delayed">Delayed</option>
        </select>
        <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="all">All sections</option>
          {facets.sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} task(s)</span>
      </div>

      {loading ? <div className="card"><Loading rows={6} /></div>
      : unavailable ? <div className="card"><Unavailable collection="maintenance_tasks" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No tasks" hint={rows.length === 0 ? 'Data unavailable in database' : 'No tasks match these filters.'} /></div>
      : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Task</th><th>Asset</th><th>Dept</th><th>Section</th><th>Priority</th><th>Risk</th><th>Severity</th><th>Overdue</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.slice(0, 300).map((r) => {
                const overdue = Number(pick(r, 'overdue_days', 'delay_days') || 0) > 0
                return (
                  <tr key={r.id}>
                    <td><b className="mono">{pick(r, 'task_id') || r.id}</b><br /><span className="muted">{pick(r, 'title', 'description') || ''}</span></td>
                    <td>{pick(r, 'asset_id', 'assetId') || '—'}</td>
                    <td>{pick(r, 'department', 'dept') || '—'}</td>
                    <td>{pick(r, 'section', 'location') || '—'}</td>
                    <td><Badge value={pick(r, 'priority')} /></td>
                    <td><Badge value={pick(r, 'risk_level', 'priority_score')} /></td>
                    <td>{pick(r, 'severity') ?? '—'}</td>
                    <td>{overdue ? <span className="badge b-red">{pick(r, 'overdue_days', 'delay_days')}d</span> : <span className="muted">—</span>}</td>
                    <td><Badge value={pick(r, 'status', 'task_status')} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

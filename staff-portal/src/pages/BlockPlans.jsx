import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, fmtDurationMin, normStatus, pick } from '../utils/format.js'
import { addRecord, fetchCollection, writeAudit } from '../services/firestoreService.js'
import { useAuth } from '../context/AuthContext.jsx'

const TABS = ['all', 'draft', 'pending approval', 'approved', 'completed', 'cancelled']

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

function blockWindowText(b) {
  const s = blockStartTime(b)
  const e = blockEndTime(b)
  const sFormatted = s ? fmtDate(s) : ''
  const eFormatted = e ? fmtDate(e) : ''
  if (sFormatted && eFormatted && sFormatted !== '—' && eFormatted !== '—') {
    return `${sFormatted} → ${eFormatted}`
  }
  if (sFormatted && sFormatted !== '—') return `Start: ${sFormatted}`
  return pick(b, 'window', 'scheduled_window') || 'Scheduled Window'
}

export default function BlockPlans() {
  const { user } = useAuth()
  const { rows, loading, unavailable } = useCollection('block_plans', { max: 500 })
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [versions, setVersions] = useState([])
  const [vState, setVState] = useState('idle')
  const [showReq, setShowReq] = useState(false)
  const [form, setForm] = useState({ section: '', start: '', end: '', departments: '', tasks: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const bucketOf = (r) => {
    const s = normStatus(pick(r, 'status', 'approval_status', 'state'))
    if (['pending', 'proposed', 'under_review', 'review', 'planned'].includes(s)) return 'pending approval'
    if (['draft'].includes(s)) return 'draft'
    if (['approved'].includes(s)) return 'approved'
    if (['completed', 'complete', 'done'].includes(s)) return 'completed'
    if (['cancelled', 'canceled', 'rejected'].includes(s)) return 'cancelled'
    return s || 'draft'
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (tab !== 'all' && bucketOf(r) !== tab) return false
      if (!needle) return true
      return [r.id, pick(r, 'plan_id'), pick(r, 'section', 'location')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, tab, q])

  const counts = useMemo(() => {
    const c = { all: rows.length, draft: 0, 'pending approval': 0, approved: 0, completed: 0, cancelled: 0 }
    rows.forEach((r) => {
      const b = bucketOf(r)
      if (c[b] !== undefined) c[b] += 1
    })
    return c
  }, [rows])

  const openDetail = async (plan) => {
    setSelected(plan)
    setVState('loading')
    const v = await fetchCollection('plan_versions', { max: 200 })
    if (v.unavailable) {
      setVState('unavailable')
      setVersions([])
    } else {
      setVState('done')
      setVersions(v.rows.filter((x) => {
        const pid = pick(x, 'plan_id', 'planId', 'block_plan_id')
        return pid && (pid === plan.id || pid === pick(plan, 'plan_id'))
      }))
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const raiseRequirement = async (e) => {
    e.preventDefault()
    setMsg(null)
    if (!form.section.trim() || !form.start || !form.end) {
      setMsg({ ok: false, text: 'Section, start and end are required.' })
      return
    }
    setSaving(true)
    try {
      const id = await addRecord('block_plans', {
        plan_id: `REQ-${Date.now().toString().slice(-6)}`,
        section: form.section.trim(),
        start_time: form.start,
        end_time: form.end,
        departments: form.departments.split(',').map((s) => s.trim()).filter(Boolean),
        tasks_included: form.tasks.split(',').map((s) => s.trim()).filter(Boolean),
        notes: form.notes.trim(),
        status: 'draft',
        raised_by: user?.email || '',
        raised_by_uid: user?.uid || '',
      })
      await writeAudit({
        user_email: user?.email || '', action: 'block_requirement_raised',
        entity_type: 'block_plan', entity_id: id, prev_status: '', new_status: 'draft',
        details: `Staff raised block requirement for ${form.section.trim()}`,
      })
      setForm({ section: '', start: '', end: '', departments: '', tasks: '', notes: '' })
      setShowReq(false)
      setMsg({ ok: true, text: 'Block requirement submitted as a draft. Admin approval happens in the Admin portal.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not submit requirement.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Block Plans</h2><p>Review AI plans and track approval. Staff cannot approve — Admin does.</p></div>
        <button className="btn btn-primary" onClick={() => { setMsg(null); setShowReq(!showReq) }}>
          {showReq ? 'Close form' : '+ Block requirement'}
        </button>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-err'}`}>{msg.text}</div>}

      {showReq && (
        <form className="card" onSubmit={raiseRequirement} style={{ marginBottom: 14 }}>
          <h3>New block requirement</h3>
          <p className="sub">Saved with status “draft”. It enters the AI pipeline and awaits Admin approval.</p>
          <div className="grid cols-3">
            <div className="field"><label>Section *</label><input className="input" value={form.section} onChange={set('section')} placeholder="e.g. SLM-ED" /></div>
            <div className="field"><label>Start *</label><input className="input" type="datetime-local" value={form.start} onChange={set('start')} /></div>
            <div className="field"><label>End *</label><input className="input" type="datetime-local" value={form.end} onChange={set('end')} /></div>
            <div className="field"><label>Departments (comma separated)</label><input className="input" value={form.departments} onChange={set('departments')} placeholder="Track, S&T" /></div>
            <div className="field"><label>Task IDs (comma separated)</label><input className="input" value={form.tasks} onChange={set('tasks')} placeholder="TASK001, TASK002" /></div>
            <div className="field"><label>Notes</label><textarea className="input" rows={2} value={form.notes} onChange={set('notes')} /></div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Submitting...' : 'Submit requirement'}</button>
          </div>
        </form>
      )}

      <div className="seg" style={{ marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)} · {counts[t] ?? 0}
          </button>
        ))}
      </div>

      {loading ? <div className="card"><Loading rows={5} /></div>
      : unavailable ? <div className="card"><Unavailable collection="block_plans" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No block plans" hint={rows.length === 0 ? 'Data unavailable in database' : 'No plans match this filter.'} /></div>
      : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Plan</th><th>Section</th><th>Window</th><th>Duration</th><th>Score</th><th>Conflicts</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="id">{pick(r, 'plan_id') || r.id}</td>
                  <td>{pick(r, 'section', 'location', 'corridor') || '—'}</td>
                  <td className="muted">{blockWindowText(r)}</td>
                  <td>{fmtDurationMin(pick(r, 'duration_min', 'durationMin', 'duration', 'block_duration'))}</td>
                  <td><b>{pick(r, 'optimization_score', 'optimizationScore') ?? '—'}</b></td>
                  <td>{pick(r, 'conflicts', 'conflict_count') ?? '—'}</td>
                  <td><Badge value={pick(r, 'status', 'approval_status')} /></td>
                  <td><button className="btn btn-sm" onClick={() => openDetail(r)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{pick(selected, 'plan_id') || selected.id}</h3>
              <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <div className="alert alert-info">Staff review only — approval authority sits with Admin.</div>
            <dl className="kv">
              <dt>Status</dt><dd><Badge value={pick(selected, 'status', 'approval_status')} /></dd>
              <dt>Section</dt><dd>{pick(selected, 'section', 'location', 'corridor') || '—'}</dd>
              <dt>Window</dt><dd>{blockWindowText(selected)}</dd>
              <dt>Duration</dt><dd>{fmtDurationMin(pick(selected, 'duration_min', 'durationMin', 'duration', 'block_duration'))}</dd>
              <dt>Departments</dt><dd>{(() => {
                const raw = pick(selected, 'departments', 'departments_involved', 'department', 'dept')
                if (Array.isArray(raw)) return raw.join(', ') || '—'
                return raw || 'Engineering / Track'
              })()}</dd>
              <dt>Tasks</dt><dd>{(() => {
                const raw = pick(selected, 'tasks', 'tasks_included', 'task_ids', 'task_list', 'task_id')
                if (Array.isArray(raw)) return raw.map(x => (typeof x === 'object' ? (pick(x, 'task_id', 'id') || JSON.stringify(x)) : String(x))).join(', ') || '—'
                return raw || '—'
              })()}</dd>
              <dt>Optimization score</dt><dd>{pick(selected, 'optimization_score', 'optimizationScore') ?? 'Data unavailable in database'}</dd>
              <dt>Conflicts</dt><dd>{pick(selected, 'conflicts', 'conflict_count') ?? '—'}</dd>
            </dl>
            <h4>Plan versions</h4>
            {vState === 'loading' ? <Loading rows={2} />
              : vState === 'unavailable' ? <p className="muted">Data unavailable in database (plan_versions).</p>
              : versions.length === 0 ? <p className="muted">No versions recorded for this plan.</p>
              : versions.map((v) => (
                <div key={v.id} className="card" style={{ marginBottom: 8, padding: 12 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <b className="mono">{pick(v, 'version', 'version_no', 'label') || v.id}</b>
                    <span className="muted" style={{ fontSize: 12 }}>{fmtDate(pick(v, 'created_at', 'timestamp'))}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{pick(v, 'notes', 'changes', 'details') || '—'}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

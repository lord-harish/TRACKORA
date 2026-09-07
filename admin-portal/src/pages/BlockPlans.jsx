import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, Card, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, fmtDurationMin, normStatus, pick } from '../utils/format.js'
import { fetchCollection, updateDocFields, writeAudit, createPlanVersion } from '../services/firestoreService.js'
import { useAuth } from '../context/AuthContext.jsx'

const TABS = ['all', 'planned', 'pending approval', 'approved', 'completed', 'cancelled']

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
  const { rows, loading, unavailable } = useCollection('block_plans', { max: 500 })
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState(null)
  const [versions, setVersions] = useState([])
  const [versionsState, setVersionsState] = useState('idle') // idle|loading|done|unavailable
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const { user } = useAuth()

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      const status = normStatus(pick(r, 'status', 'approval_status', 'approvalStatus', 'state'))
      if (tab !== 'all') {
        if (tab === 'pending approval' && !['pending', 'proposed', 'under_review', 'review', 'draft', 'planned'].includes(status)) return false
        if (tab !== 'pending approval' && status !== normStatus(tab)) return false
      }
      if (!needle) return true
      return [r.id, pick(r, 'plan_id'), pick(r, 'section', 'location'), pick(r, 'corridor')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, tab, q])

  const counts = useMemo(() => {
    const c = { all: rows.length }
    for (const t of TABS.slice(1)) {
      c[t] = rows.filter((r) => {
        const s = normStatus(pick(r, 'status', 'approval_status', 'state'))
        if (t === 'pending approval') return ['pending', 'proposed', 'under_review', 'review', 'draft', 'planned'].includes(s)
        return s === normStatus(t)
      }).length
    }
    return c
  }, [rows])

  const openDetail = async (plan) => {
    setSelected(plan)
    setMsg('')
    setVersionsState('loading')
    const v = await fetchCollection('plan_versions', { max: 200 })
    if (v.unavailable) {
      setVersionsState('unavailable')
      setVersions([])
    } else {
      setVersionsState('done')
      setVersions(v.rows.filter((x) => {
        const pid = pick(x, 'plan_id', 'planId', 'block_plan_id')
        return pid && (pid === plan.id || pid === pick(plan, 'plan_id'))
      }))
    }
    const a = await fetchCollection('audit_logs', { max: 200 })
    if (!a.unavailable) {
      setHistory(a.rows.filter((x) => {
        const eid = pick(x, 'entity_id', 'entityId')
        return eid && (eid === plan.id || eid === pick(plan, 'plan_id'))
      }).slice(0, 20))
    } else setHistory([])
  }

  const decide = async (ok) => {
    if (!selected) return
    setBusy(ok ? 'approve' : 'reject')
    setMsg('')
    try {
      const prev = pick(selected, 'status', 'approval_status') || 'pending'
      const next = ok ? 'approved' : 'rejected'
      const patch = {}
      if (selected.status !== undefined) patch.status = next
      if (selected.approval_status !== undefined) patch.approval_status = next
      if (selected.approvalStatus !== undefined) patch.approvalStatus = next
      if (Object.keys(patch).length === 0) patch.status = next
      await updateDocFields('block_plans', selected.id, patch)
      await createPlanVersion({
        plan_id: selected.id,
        version: String((versions.length + 1) + '.0'),
        reason: `Admin ${ok ? 'approved' : 'rejected'} block plan`,
        schedule_snapshot: {
          section: selected.section,
          block_start: selected.block_start || selected.start_time || '',
          block_end: selected.block_end || selected.end_time || '',
          duration_min: selected.duration_min || null,
          task_ids: selected.task_ids || selected.tasks || [],
          status: next,
        },
        created_by: user?.email || 'admin',
        status: next,
      })
      await writeAudit({
        user_email: user?.email || '',
        action: ok ? 'block_plan_approved' : 'block_plan_rejected',
        entity_type: 'block_plan',
        entity_id: selected.id,
        prev_status: String(prev),
        new_status: next,
        details: `Admin ${ok ? 'approved' : 'rejected'} plan ${selected.id}`,
      })
      setSelected({ ...selected, ...patch })
      setMsg(ok ? 'Plan approved, versioned, and logged.' : 'Plan rejected, versioned, and logged.')
    } catch (e) {
      setMsg(e.message || 'Update failed. Check Firestore rules.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Block Plans</h2><p>AI-generated plans from the backend pipeline — approve or reject with full traceability.</p></div>
      </div>

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
            <thead><tr>
              <th>Plan</th><th>Section</th><th>Window</th><th>Duration</th><th>Depts</th>
              <th>Score</th><th>Conflicts</th><th>Status</th><th></th>
            </tr></thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td className="id">{pick(r, 'plan_id', 'planId', 'title') || r.id}</td>
                  <td>{pick(r, 'section', 'location', 'corridor', 'station') || '—'}</td>
                  <td className="muted">{blockWindowText(r)}</td>
                  <td>{fmtDurationMin(pick(r, 'duration_min', 'durationMin', 'duration', 'block_duration'))}</td>
                  <td className="muted">{Array.isArray(pick(r, 'departments', 'departments_involved')) ? pick(r, 'departments', 'departments_involved').join(', ') : (pick(r, 'department', 'departments', 'departments_involved', 'dept') || '—')}</td>
                  <td><b>{pick(r, 'optimization_score', 'optimizationScore', 'score') ?? '—'}</b></td>
                  <td>{pick(r, 'conflicts', 'conflict_count', 'conflictCount') ?? '—'}</td>
                  <td><Badge value={pick(r, 'status', 'approval_status', 'approvalStatus')} /></td>
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
              <h3 style={{ margin: 0 }}>Plan {pick(selected, 'plan_id') || selected.id}</h3>
              <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <p className="muted">Review AI output, tasks, versions and history before deciding.</p>
            {msg && <div className="alert alert-info">{msg}</div>}
            <dl className="kv">
              <dt>Status</dt><dd><Badge value={pick(selected, 'status', 'approval_status')} /></dd>
              <dt>Section</dt><dd>{pick(selected, 'section', 'location', 'corridor') || '—'}</dd>
              <dt>Window</dt><dd>{blockWindowText(selected)}</dd>
              <dt>Duration</dt><dd>{fmtDurationMin(pick(selected, 'duration_min', 'durationMin', 'duration', 'block_duration'))}</dd>
              <dt>Departments</dt><dd>{Array.isArray(pick(selected, 'departments', 'departments_involved')) ? pick(selected, 'departments', 'departments_involved').join(', ') : (pick(selected, 'department', 'departments', 'departments_involved', 'dept') || 'Engineering / Track')}</dd>
              <dt>Tasks</dt><dd>{Array.isArray(pick(selected, 'tasks', 'tasks_included', 'task_ids')) ? pick(selected, 'tasks', 'tasks_included', 'task_ids').join(', ') : (pick(selected, 'tasks', 'tasks_included', 'task_ids') || '—')}</dd>
              <dt>Optimization score</dt><dd>{pick(selected, 'optimization_score', 'optimizationScore', 'score') ?? 'Data unavailable in database'}</dd>
              <dt>Conflicts</dt><dd>{pick(selected, 'conflicts', 'conflict_count') ?? '—'}</dd>
              <dt>Ranking source</dt><dd>{pick(selected, 'model', 'pipeline', 'ranker') || 'Backend pipeline (RF → XGBRanker → CP-SAT) when available'}</dd>
            </dl>
            <div className="row" style={{ margin: '12px 0' }}>
              <button className="btn btn-green" disabled={!!busy} onClick={() => decide(true)}>{busy === 'approve' ? 'Approving…' : 'Approve plan'}</button>
              <button className="btn btn-danger" disabled={!!busy} onClick={() => decide(false)}>{busy === 'reject' ? 'Rejecting…' : 'Reject'}</button>
            </div>
            <div className="divider"></div>
            <h4 style={{ margin: '0 0 8px' }}>Plan versions</h4>
            {versionsState === 'loading' ? <Loading rows={2} />
              : versionsState === 'unavailable' ? <p className="muted">Data unavailable in database (plan_versions).</p>
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
            <h4 style={{ margin: '14px 0 8px' }}>Rollback / history</h4>
            {history.length === 0 ? <p className="muted">No audit entries reference this plan yet.</p>
              : history.map((h) => (
                <div key={h.id} className="row" style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 12 }}><b>{pick(h, 'action')}</b> · {pick(h, 'previous_status', 'prev_status') || ''} → {pick(h, 'new_status', 'newStatus') || ''}<br /><span className="muted">{fmtDate(pick(h, 'timestamp', 'created_at'))} · {pick(h, 'user', 'user_email') || ''}</span></div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'
import { addRecord, updateDocFields, writeAudit } from '../services/firestoreService.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function Assignments() {
  const { user } = useAuth()
  const assigns = useCollection('work_assignments', { max: 500 })
  const tasks = useCollection('maintenance_tasks', { max: 500 })
  const users = useCollection('users', { max: 500 })
  const blocks = useCollection('block_plans', { max: 500 })
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ task_id: '', plan_id: '', worker: '', start: '', end: '', instructions: '' })
  const [reassign, setReassign] = useState(null)
  const [newWorker, setNewWorker] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const workers = useMemo(() => {
    if (users.unavailable) return []
    return users.rows.filter((u) => normStatus(pick(u, 'role', 'user_role')) === 'worker')
  }, [users])

  const taskName = (tid) => {
    if (!tid) return '—'
    const t = tasks.rows.find((x) => String(pick(x, 'task_id', 'taskId') || x.id) === String(tid))
    return t ? (pick(t, 'title', 'task_name', 'description') || tid) : tid
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return assigns.rows.filter((a) => {
      if (!needle) return true
      return [a.id, pick(a, 'task_id', 'taskId'), pick(a, 'plan_id', 'planId'), pick(a, 'worker', 'worker_name', 'assignee'), pick(a, 'section', 'location')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [assigns.rows, q])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    setMsg(null)
    if (!form.task_id.trim() || !form.worker.trim()) {
      setMsg({ ok: false, text: 'Task ID and worker are required.' })
      return
    }
    setBusy(true)
    try {
      const workerVal = form.worker.trim()
      const assignmentPayload = {
        task_id: form.task_id.trim(),
        plan_id: form.plan_id ? form.plan_id.trim() : '',
        worker: workerVal,
        employee_id: workerVal,
        worker_id: workerVal,
        planned_start: form.start || null,
        planned_end: form.end || null,
        instructions: form.instructions.trim(),
        status: 'assigned',
        assigned_by: user?.email || '',
        assigned_by_uid: user?.uid || '',
        assigned_at: new Date().toISOString(),
      }
      const id = await addRecord('work_assignments', assignmentPayload)

      // Also update corresponding maintenance_tasks doc to status = 'assigned'
      const matchedTask = tasks.rows.find((t) => t.id === form.task_id.trim() || String(pick(t, 'task_id', 'taskId')) === form.task_id.trim())
      if (matchedTask) {
        try {
          await updateDocFields('maintenance_tasks', matchedTask.id, {
            status: 'assigned',
            task_status: 'assigned',
            assigned_worker: workerVal,
            assigned_employee_id: workerVal,
            employee_id: workerVal,
            assigned_worker_id: workerVal,
            assignment_id: id,
            plan_id: form.plan_id ? form.plan_id.trim() : (matchedTask.plan_id || ''),
          })
        } catch (taskErr) {
          console.warn('[Assignments] Could not update task status:', taskErr.message)
        }
      }

      await writeAudit({
        user_email: user?.email || '', action: 'work_assigned',
        entity_type: 'work_assignment', entity_id: id, prev_status: '', new_status: 'assigned',
        details: `Staff assigned ${form.task_id.trim()} to ${form.worker.trim()}${form.plan_id ? ' under plan ' + form.plan_id.trim() : ''}`,
      })
      setForm({ task_id: '', plan_id: '', worker: '', start: '', end: '', instructions: '' })
      setShowForm(false)
      setMsg({ ok: true, text: 'Worker assigned and task status updated. Worker sees this immediately in real time.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not create assignment.' })
    } finally {
      setBusy(false)
    }
  }

  const doReassign = async () => {
    if (!reassign || !newWorker.trim()) return
    setBusy(true)
    setMsg(null)
    try {
      const prev = pick(reassign, 'worker', 'worker_name', 'assignee') || ''
      const newWorkerVal = newWorker.trim()
      await updateDocFields('work_assignments', reassign.id, {
        worker: newWorkerVal,
        employee_id: newWorkerVal,
        worker_id: newWorkerVal,
        status: 'assigned',
      })
      await writeAudit({
        user_email: user?.email || '', action: 'work_reassigned',
        entity_type: 'work_assignment', entity_id: reassign.id, prev_status: String(pick(reassign, 'status') || ''),
        new_status: 'assigned', details: `Reassigned from ${prev} to ${newWorker.trim()}`,
      })
      setReassign(null)
      setNewWorker('')
      setMsg({ ok: true, text: 'Work reassigned.' })
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not reassign.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div><h2>Work Assignments</h2><p>Assign workers, reassign where permitted, track progress.</p></div>
        <button className="btn btn-primary" onClick={() => { setMsg(null); setShowForm(!showForm) }}>
          {showForm ? 'Close form' : '+ Assign work'}
        </button>
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-err'}`}>{msg.text}</div>}

      {showForm && (
        <form className="card" onSubmit={create} style={{ marginBottom: 14 }}>
          <h3>New assignment</h3>
          <p className="sub">Worker sees this in their Worker Portal immediately (shared database).</p>
          <div className="grid cols-3">
            <div className="field"><label>Task ID *</label>
              <input className="input" list="staff-task-ids" value={form.task_id} onChange={set('task_id')} placeholder="TASK001" />
              <datalist id="staff-task-ids">
                {tasks.rows.slice(0, 100).map((t) => <option key={t.id} value={pick(t, 'task_id', 'taskId') || t.id} />)}
              </datalist>
            </div>
            <div className="field"><label>Block Plan ID (optional)</label>
              <input className="input" list="staff-plan-ids" value={form.plan_id} onChange={set('plan_id')} placeholder="PLAN001" />
              <datalist id="staff-plan-ids">
                {blocks.rows.slice(0, 100).map((b) => <option key={b.id} value={pick(b, 'plan_id', 'planId') || b.id} />)}
              </datalist>
            </div>
            <div className="field"><label>Worker (email, UID or employee ID like EMP003, EMP004) *</label>
              <input className="input" list="staff-workers" value={form.worker} onChange={set('worker')} placeholder="EMP003 or worker email" />
              <datalist id="staff-workers">
                {workers.map((w) => {
                  const eid = pick(w, 'employee_id', 'employeeId', 'emp_id') || (w.worker_id && !String(w.worker_id).startsWith('WORKER') ? w.worker_id : '') || w.id
                  return <option key={w.id} value={eid}>{pick(w, 'name') || ''} ({eid})</option>
                })}
              </datalist>
            </div>
            <div className="field"><label>Planned start</label><input className="input" type="datetime-local" value={form.start} onChange={set('start')} /></div>
            <div className="field"><label>Planned end</label><input className="input" type="datetime-local" value={form.end} onChange={set('end')} /></div>
            <div className="field"><label>Instructions</label><textarea className="input" rows={2} value={form.instructions} onChange={set('instructions')} /></div>
          </div>
          {users.unavailable && <p className="muted" style={{ fontSize: 12 }}>Worker directory unavailable in database (users) — enter the worker email manually.</p>}
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Assigning...' : 'Assign work'}</button>
          </div>
        </form>
      )}

      {assigns.loading ? <div className="card"><Loading rows={5} /></div>
      : assigns.unavailable ? <div className="card"><Unavailable collection="work_assignments" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No assignments" hint={assigns.rows.length === 0 ? 'Data unavailable in database' : 'No assignments match.'} /></div>
      : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Assignment</th><th>Task</th><th>Worker</th><th>Planned</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {filtered.slice(0, 300).map((a) => (
                <tr key={a.id}>
                  <td className="id">{a.id}</td>
                  <td>{taskName(pick(a, 'task_id', 'taskId'))}<br /><span className="muted mono">{pick(a, 'task_id', 'taskId') || ''}</span></td>
                  <td>{pick(a, 'worker', 'worker_name', 'assignee', 'worker_email') || '—'}</td>
                  <td className="muted">{fmtDate(pick(a, 'planned_start', 'assigned_at'))} → {fmtDate(pick(a, 'planned_end'))}</td>
                  <td><Badge value={pick(a, 'status')} /></td>
                  <td><button className="btn btn-sm" onClick={() => { setReassign(a); setNewWorker('') }}>Reassign</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reassign && (
        <div className="modal-wrap" onClick={() => setReassign(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Reassign {reassign.id}</h3>
            <p className="muted">Currently: {pick(reassign, 'worker', 'worker_name', 'assignee') || '—'}</p>
            <div className="field">
              <label>New worker (email, UID or employee ID like EMP003, EMP004)</label>
              <input className="input" list="staff-workers-2" value={newWorker} onChange={(e) => setNewWorker(e.target.value)} placeholder="EMP003 or worker email" />
              <datalist id="staff-workers-2">
                {workers.map((w) => {
                  const eid = pick(w, 'employee_id', 'employeeId', 'emp_id') || (w.worker_id && !String(w.worker_id).startsWith('WORKER') ? w.worker_id : '') || w.id
                  return <option key={w.id} value={eid}>{pick(w, 'name') || ''} ({eid})</option>
                })}
              </datalist>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" disabled={busy || !newWorker.trim()} onClick={doReassign}>{busy ? 'Saving...' : 'Confirm reassign'}</button>
              <button className="btn" onClick={() => setReassign(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

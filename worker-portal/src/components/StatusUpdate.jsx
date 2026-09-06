// Shared worker action: Start Work -> Update Progress -> Complete Work (+ Delayed).
// Writes to status_updates, patches the task/assignment status (best effort),
// and appends an audit_logs entry. Never touches other workers' records.
import { useState } from 'react'
import { submitStatusUpdate, updateDocFields, writeAudit } from '../services/firestoreService.js'
import { normStatus, pick } from '../utils/format.js'

const FLOW = ['assigned', 'in_progress', 'completed']

export function nextActions(current) {
  const s = normStatus(current)
  if (['completed', 'complete', 'done', 'closed'].includes(s)) return []
  if (['in_progress', 'inprogress', 'ongoing', 'active'].includes(s))
    return [
      { to: 'in_progress', label: 'Update Progress', kind: '' },
      { to: 'completed', label: 'Complete Work', kind: 'btn-green', confirm: true },
      { to: 'delayed', label: 'Mark Delayed', kind: 'btn-amber' },
    ]
  return [
    { to: 'in_progress', label: 'Start Work', kind: 'btn-primary' },
    { to: 'delayed', label: 'Mark Delayed', kind: 'btn-amber' },
  ]
}

export function StatusActions({ task, assignment, user, onDone }) {
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null) // {ok, text}
  const current = pick(task, 'status', 'task_status') || 'assigned'
  const actions = nextActions(current)

  const run = async (a) => {
    if (a.confirm && !window.confirm(`Mark "${pick(task, 'task_id') || task.id}" as COMPLETED? This will be recorded in the system.`)) return
    setBusy(a.to)
    setMsg(null)
    try {
      // 1) status_updates record (timestamp, worker, task, assignment, status, remarks)
      await submitStatusUpdate({
        taskId: String(pick(task, 'task_id', 'taskId') || task.id),
        assignmentId: assignment ? String(assignment.id) : '',
        workerId: user?.uid || '',
        workerEmail: user?.email || '',
        prevStatus: String(current),
        newStatus: a.to,
        remarks: remarks.trim(),
      })
      // 2) patch task + assignment status (best effort — rules may restrict)
      const warnings = []
      try {
        const patch = {}
        if (task.status !== undefined) patch.status = a.to
        if (task.task_status !== undefined) patch.task_status = a.to
        if (Object.keys(patch).length === 0) patch.status = a.to
        if (a.to === 'in_progress' && task.actual_start === undefined && task.actualStart === undefined) patch.actual_start = new Date().toISOString()
        if (a.to === 'completed') patch.actual_completion = new Date().toISOString()
        await updateDocFields('maintenance_tasks', task.id, patch)
      } catch (e) {
        warnings.push('task status not updated (permissions)')
      }
      if (assignment) {
        try {
          await updateDocFields('work_assignments', assignment.id, { status: a.to })
        } catch (e) {
          warnings.push('assignment status not updated (permissions)')
        }
      }
      // 3) audit trail (best effort)
      await writeAudit({
        user_email: user?.email || '',
        action: `task_${a.to}`,
        entity_type: 'maintenance_task',
        entity_id: String(pick(task, 'task_id') || task.id),
        prev_status: String(current),
        new_status: a.to,
        details: remarks.trim() || `Worker ${a.to}`,
      })
      setMsg({ ok: true, text: `Status saved: ${a.to.replace(/_/g, ' ')}.${warnings.length ? ' Note: ' + warnings.join('; ') + '.' : ''}` })
      setRemarks('')
      onDone && onDone(a.to)
    } catch (e) {
      setMsg({ ok: false, text: e.message || 'Could not save status. Try again.' })
    } finally {
      setBusy('')
    }
  }

  if (actions.length === 0) return <div className="alert alert-ok">This task is completed. No further actions.</div>

  return (
    <div>
      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-err'}`}>{msg.text}</div>}
      <div className="field" style={{ marginBottom: 10 }}>
        <label htmlFor="sw-remarks">Remarks (optional)</label>
        <textarea
          id="sw-remarks"
          className="input"
          rows={2}
          placeholder="e.g. work done, materials used, issues found"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {actions
          .filter((a) => a.to !== 'in_progress' || normStatus(current) !== 'in_progress' || a.label === 'Update Progress')
          .map((a) => (
            <button key={a.to + a.label} className={`btn btn-block ${a.kind}`} disabled={!!busy} onClick={() => run(a)}>
              {busy === a.to ? 'Saving...' : a.label}
            </button>
          ))}
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        Allowed flow: Assigned → In Progress → Completed{normStatus(current) === 'in_progress' ? '' : ' (or Delayed)'}.
        Every update is timestamped and recorded.
      </p>
    </div>
  )
}

export { FLOW }

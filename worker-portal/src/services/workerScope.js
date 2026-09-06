// Worker scoping: a worker sees ONLY their own assignments/tasks.
// Field-tolerant: assignment docs may reference the worker by uid or email
// under several possible field names.
import { normStatus, pick } from '../utils/format.js'

const WORKER_FIELDS = ['worker_id', 'workerId', 'uid', 'assigned_to', 'assignedTo', 'assignee_id', 'worker', 'assignee', 'worker_name']
const WORKER_EMAIL_FIELDS = ['worker_email', 'workerEmail', 'email', 'assignee_email']

export function identityMatch(value, user) {
  if (!value || !user) return false
  const v = String(value).trim().toLowerCase()
  if (user.uid && v === String(user.uid).toLowerCase()) return true
  if (user.email && v === String(user.email).toLowerCase()) return true
  return false
}

export function assignmentBelongsTo(a, user) {
  if (!a || !user) return false
  for (const f of WORKER_FIELDS) {
    if (a[f] !== undefined && identityMatch(a[f], user)) return true
  }
  for (const f of WORKER_EMAIL_FIELDS) {
    if (a[f] !== undefined && user.email && String(a[f]).trim().toLowerCase() === String(user.email).toLowerCase()) return true
  }
  return false
}

export function taskBelongsTo(t, user) {
  if (!t || !user) return false
  const direct = [
    'assigned_worker', 'assignee', 'worker', 'worker_name',
    'worker_id', 'workerId', 'assigned_to', 'assignedTo',
  ]
  for (const f of direct) {
    if (t[f] !== undefined && identityMatch(t[f], user)) return true
  }
  for (const f of WORKER_EMAIL_FIELDS) {
    if (t[f] !== undefined && user.email && String(t[f]).trim().toLowerCase() === String(user.email).toLowerCase()) return true
  }
  return false
}

export function myAssignmentTaskIds(assignments) {
  const s = new Set()
  for (const a of assignments) {
    const t = pick(a, 'task_id', 'taskId')
    if (t) s.add(String(t))
  }
  return s
}

// Tasks visible to this worker: directly assigned OR linked from my assignments.
export function myTasks(allTasks, myAssignments, user) {
  const linked = myAssignmentTaskIds(myAssignments)
  return allTasks.filter((t) => {
    const tid = String(pick(t, 'task_id', 'taskId') || t.id)
    if (linked.has(tid) || linked.has(String(t.id))) return true
    return taskBelongsTo(t, user)
  })
}

// Blocks relevant to this worker: approved blocks whose task list overlaps my
// tasks, or whose section/department matches my work. Never invent links:
// a block qualifies only on a concrete match.
export function myBlocks(allBlocks, myTaskIds, profile) {
  const mySections = new Set(
    (Array.isArray(profile?.sections) ? profile.sections : [pick(profile, 'section', 'assigned_section', 'location')])
      .filter(Boolean).map((s) => String(s).toLowerCase())
  )
  const myDept = String(pick(profile, 'department', 'dept') || '').toLowerCase()
  return allBlocks.filter((b) => {
    const tasks = pick(b, 'tasks', 'tasks_included', 'task_ids', 'task_list')
    const list = Array.isArray(tasks) ? tasks.map((x) => String(typeof x === 'object' ? pick(x, 'task_id', 'id') || '' : x)) : []
    if (list.some((t) => t && myTaskIds.has(t))) return true
    const sec = String(pick(b, 'section', 'location', 'corridor') || '').toLowerCase()
    if (sec && mySections.has(sec)) return true
    const dep = pick(b, 'department', 'departments', 'departments_involved')
    const deps = (Array.isArray(dep) ? dep : [dep]).filter(Boolean).map((d) => String(d).toLowerCase())
    if (myDept && deps.includes(myDept)) return true
    return false
  })
}

export function blockBucket(b) {
  const s = normStatus(pick(b, 'status', 'approval_status', 'approvalStatus'))
  if (['cancelled', 'canceled', 'rejected'].includes(s)) return 'cancelled'
  if (['completed', 'complete', 'done', 'closed'].includes(s)) return 'completed'
  if (['active', 'in_progress', 'ongoing', 'live'].includes(s)) return 'active'
  return 'upcoming'
}

export function taskBucket(t) {
  const s = normStatus(pick(t, 'status', 'task_status'))
  if (['completed', 'complete', 'done', 'closed'].includes(s)) return 'completed'
  if (['delayed', 'overdue'].includes(s)) return 'delayed'
  if (['in_progress', 'inprogress', 'ongoing', 'active'].includes(s)) return 'in_progress'
  return 'pending'
}

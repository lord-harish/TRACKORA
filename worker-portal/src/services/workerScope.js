// Worker scoping: a worker sees ONLY their own assignments/tasks.
// Identified by employee_id (e.g. EMP003, EMP004), UID, or email.
import { normStatus, pick } from '../utils/format.js'

const WORKER_FIELDS = [
  'employee_id', 'employeeId', 'emp_id', 'empId', 'assigned_employee_id',
  'worker_id', 'workerId', 'worker_uid', 'workerUid', 'user_id', 'userId', 'uid',
  'assigned_to', 'assignedTo', 'assignee_id', 'technician_id', 'technicianId', 'worker', 'assignee', 'worker_name'
]
const WORKER_EMAIL_FIELDS = ['worker_email', 'workerEmail', 'email', 'assignee_email', 'technician_email', 'technicianEmail']
const TASK_ID_FIELDS = ['task_id', 'taskId', 'maintenance_task_id', 'maintenanceTaskId', 'task']

export function identityMatch(value, user) {
  if (!value || !user) return false
  const v = String(value).trim().toLowerCase()
  if (user.uid && v === String(user.uid).toLowerCase()) return true
  if (user.email && v === String(user.email).toLowerCase()) return true
  return false
}

// Employee ID codes stored on the user profile (e.g. employee_id: "EMP003", "EMP004").
// Assignments/tasks carry the same employee_id code in their worker fields.
const PROFILE_ID_FIELDS = ['employee_id', 'employeeId', 'emp_id', 'empId', 'worker_id', 'workerId', 'code', 'staff_id']

export function profileIds(profile) {
  const s = new Set()
  if (!profile) return s
  for (const f of PROFILE_ID_FIELDS) {
    const v = profile[f]
    if (v !== undefined && v !== null && String(v).trim() !== '') s.add(String(v).trim().toLowerCase())
  }
  return s
}

function matchesProfileId(value, ids) {
  if (value === undefined || value === null || ids.size === 0) return false
  return ids.has(String(value).trim().toLowerCase())
}

export function assignmentBelongsTo(a, user, profile) {
  if (!a || (!user && !profile)) return false
  for (const f of WORKER_FIELDS) {
    if (a[f] !== undefined && identityMatch(a[f], user)) return true
  }
  for (const f of WORKER_EMAIL_FIELDS) {
    if (a[f] !== undefined && user?.email && String(a[f]).trim().toLowerCase() === String(user.email).toLowerCase()) return true
  }
  const ids = profileIds(profile)
  if (ids.size > 0) {
    for (const f of [...WORKER_FIELDS, ...WORKER_EMAIL_FIELDS]) {
      if (a[f] !== undefined && matchesProfileId(a[f], ids)) return true
    }
  }
  return false
}

export function taskIdOf(obj) {
  const v = pick(obj, ...TASK_ID_FIELDS)
  if (v !== undefined && v !== null && v !== '') return String(v)
  if (obj && obj.id !== undefined) return String(obj.id)
  return ''
}

export function taskBelongsTo(t, user, profile) {
  if (!t || (!user && !profile)) return false
  const direct = [
    'employee_id', 'employeeId', 'emp_id', 'empId', 'assigned_employee_id',
    'assigned_worker', 'assignee', 'worker', 'worker_name',
    'worker_id', 'workerId', 'assigned_to', 'assignedTo',
    'technician', 'technician_id', 'technicianId',
  ]
  for (const f of direct) {
    if (t[f] !== undefined && identityMatch(t[f], user)) return true
  }
  for (const f of WORKER_EMAIL_FIELDS) {
    if (t[f] !== undefined && user?.email && String(t[f]).trim().toLowerCase() === String(user.email).toLowerCase()) return true
  }
  const ids = profileIds(profile)
  if (ids.size > 0) {
    for (const f of [...direct, ...WORKER_EMAIL_FIELDS]) {
      if (t[f] !== undefined && matchesProfileId(t[f], ids)) return true
    }
  }
  return false
}

export function myAssignmentTaskIds(assignments) {
  const s = new Set()
  for (const a of assignments) {
    const t = pick(a, ...TASK_ID_FIELDS)
    if (t !== undefined && t !== null && t !== '') s.add(String(t))
  }
  return s
}

// Tasks visible to this worker: directly assigned OR linked from my assignments.
export function myTasks(allTasks, myAssignments, user, profile) {
  const linked = myAssignmentTaskIds(myAssignments)
  return allTasks.filter((t) => {
    const tid = taskIdOf(t)
    if (tid && linked.has(tid)) return true
    return taskBelongsTo(t, user, profile)
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

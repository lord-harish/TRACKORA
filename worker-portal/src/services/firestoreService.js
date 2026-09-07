// Central Firestore access layer.
// Never fabricate data: on missing collection / permission error,
// callers receive { rows: [], unavailable: true } and must render
// "Data unavailable in database".
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  onSnapshot,
} from 'firebase/firestore'
import { db, isFirebaseConfigured } from '../firebase.js'

export const COLLECTIONS = [
  'users',
  'assets',
  'maintenance_tasks',
  'train_movements',
  'goods_forecasts',
  'corridor_blocks',
  'weather',
  'candidate_windows',
  'block_plans',
  'plan_versions',
  'work_assignments',
  'status_updates',
  'audit_logs',
]

export function missingDb() {
  return !isFirebaseConfigured || !db
}

export async function fetchCollection(name, { orderField = null, orderDir = 'desc', max = 500, filters = [] } = {}) {
  if (missingDb()) return { rows: [], unavailable: true, reason: 'not-configured' }
  try {
    let q = collection(db, name)
    const clauses = []
    for (const f of filters) clauses.push(where(f.field, f.op, f.value))
    if (orderField) clauses.push(orderBy(orderField, orderDir))
    clauses.push(limit(max))
    q = clauses.length ? query(q, ...clauses) : q
    const snap = await getDocs(q)
    return { rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })), unavailable: false }
  } catch (e) {
    console.warn(`[TRACKORA Worker] ${name} unavailable:`, e?.code || e?.message)
    return { rows: [], unavailable: true, reason: e?.code || 'error' }
  }
}

export function subscribeCollection(name, options = {}, onUpdate, onError) {
  if (missingDb()) {
    onUpdate({ rows: [], unavailable: true, reason: 'not-configured' })
    return () => {}
  }
  const { orderField = null, orderDir = 'desc', max = 500, filters = [] } = options
  try {
    let q = collection(db, name)
    const clauses = []
    for (const f of filters) clauses.push(where(f.field, f.op, f.value))
    if (orderField) clauses.push(orderBy(orderField, orderDir))
    clauses.push(limit(max))
    q = clauses.length ? query(q, ...clauses) : q

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        onUpdate({ rows, unavailable: false })
      },
      (err) => {
        console.warn(`[TRACKORA Worker] ${name} live listener issue:`, err?.code || err?.message)
        if (onError) onError(err)
        fetchCollection(name, options).then(onUpdate).catch(() => {
          onUpdate({ rows: [], unavailable: true, reason: err?.code || 'error' })
        })
      }
    )
    return unsub
  } catch (err) {
    console.warn(`[TRACKORA Worker] ${name} subscription setup issue:`, err?.message)
    fetchCollection(name, options).then(onUpdate).catch(() => {
      onUpdate({ rows: [], unavailable: true, reason: err?.message || 'error' })
    })
    return () => {}
  }
}

export async function fetchDocById(collectionName, id) {
  if (missingDb()) return { data: null, unavailable: true }
  try {
    const snap = await getDoc(doc(db, collectionName, id))
    if (!snap.exists()) return { data: null, unavailable: false, missing: true }
    return { data: { id: snap.id, ...snap.data() }, unavailable: false }
  } catch {
    return { data: null, unavailable: true }
  }
}

export async function addRecord(collectionName, data) {
  if (missingDb()) throw new Error('Database not configured')
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })
  return ref.id
}

export async function updateDocFields(collectionName, id, fields) {
  if (missingDb()) throw new Error('Database not configured')
  await updateDoc(doc(db, collectionName, id), { ...fields, updated_at: serverTimestamp() })
}

// Worker status update: Assigned -> In Progress -> Completed (+ Delayed).
// Records timestamp, worker, task, assignment, status and remarks.
export async function submitStatusUpdate({ taskId, assignmentId, workerId, employeeId, workerEmail, prevStatus, newStatus, remarks }) {
  if (missingDb()) throw new Error('Database not configured')
  const empId = employeeId || workerId || ''
  const ref = await addDoc(collection(db, 'status_updates'), {
    task_id: taskId || '',
    assignment_id: assignmentId || '',
    employee_id: empId,
    worker_id: empId,
    worker: empId || workerEmail || '',
    user: workerEmail || empId || '',
    previous_status: prevStatus || '',
    new_status: newStatus,
    status: newStatus,
    message: remarks || '',
    remarks: remarks || '',
    timestamp: serverTimestamp(),
    created_at: serverTimestamp(),
  })
  return ref.id
}

export async function writeAudit({ user_email = '', action = '', entity_type = '', entity_id = '', prev_status = '', new_status = '', details = '' }) {
  if (missingDb()) return
  try {
    await addDoc(collection(db, 'audit_logs'), {
      timestamp: serverTimestamp(),
      created_at: serverTimestamp(),
      user: user_email,
      user_email,
      action,
      entity_type,
      entity_id,
      previous_status: prev_status,
      new_status,
      details,
    })
  } catch (e) {
    console.warn('[TRACKORA Worker] audit write failed:', e?.message)
  }
}

export async function getUserDoc(uid) {
  if (missingDb()) return { data: null, unavailable: true }
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) return { data: null, unavailable: false, missing: true }
    return { data: { id: snap.id, ...snap.data() }, unavailable: false }
  } catch (e) {
    return { data: null, unavailable: true }
  }
}

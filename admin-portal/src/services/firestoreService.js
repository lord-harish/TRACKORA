// Central Firestore access layer.
// Rule: never fabricate data. On missing collection / permission error,
// callers receive { rows: [], unavailable: true } and must render
// "Data unavailable in database".
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  updateDoc,
  serverTimestamp,
  addDoc,
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
    console.warn(`[TRACKORA] ${name} unavailable:`, e?.code || e?.message)
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
        console.warn(`[TRACKORA] ${name} live listener issue:`, err?.code || err?.message)
        if (onError) onError(err)
        fetchCollection(name, options).then(onUpdate).catch(() => {
          onUpdate({ rows: [], unavailable: true, reason: err?.code || 'error' })
        })
      }
    )
    return unsub
  } catch (err) {
    console.warn(`[TRACKORA] ${name} subscription setup issue:`, err?.message)
    fetchCollection(name, options).then(onUpdate).catch(() => {
      onUpdate({ rows: [], unavailable: true, reason: err?.message || 'error' })
    })
    return () => {}
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

export async function updateDocFields(collectionName, id, fields) {
  if (missingDb()) throw new Error('Database not configured')
  await updateDoc(doc(db, collectionName, id), { ...fields, updated_at: serverTimestamp() })
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
    console.warn('[TRACKORA] audit write failed:', e?.message)
  }
}

export async function createPlanVersion({ plan_id, version = '1.0', reason = '', schedule_snapshot = {}, created_by = '', status = '' }) {
  if (missingDb()) return
  try {
    const ref = await addDoc(collection(db, 'plan_versions'), {
      plan_id: String(plan_id),
      version: String(version),
      reason: String(reason),
      schedule_snapshot,
      created_by: String(created_by),
      status: String(status),
      created_at: serverTimestamp(),
      timestamp: serverTimestamp(),
    })
    return ref.id
  } catch (e) {
    console.warn('[TRACKORA] plan_version write failed:', e?.message)
  }
}

// FastAPI-ready helper: optional backend base URL (for future
// RandomForest -> XGBRanker -> CP-SAT pipeline results).
export const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
export async function fetchAiResult(path) {
  if (!API_BASE) return { data: null, unavailable: true, reason: 'no-backend' }
  try {
    const res = await fetch(`${API_BASE}${path}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { data: await res.json(), unavailable: false }
  } catch (e) {
    return { data: null, unavailable: true, reason: e.message }
  }
}

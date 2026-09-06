export function pick(obj, ...keys) {
  if (!obj) return undefined
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k]
  }
  return undefined
}

export function normStatus(v) {
  return String(v ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '_')
}

export function toDate(v) {
  if (!v) return null
  try {
    if (typeof v.toDate === 'function') return v.toDate()
    if (v.seconds) return new Date(v.seconds * 1000)
    const d = new Date(v)
    return isNaN(d) ? null : d
  } catch {
    return null
  }
}

export function fmtDate(v) {
  const d = toDate(v)
  return d ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
}

export function fmtDateOnly(v) {
  const d = toDate(v)
  return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

export function fmtDurationMin(min) {
  if (min === undefined || min === null || min === '') return '—'
  const m = Number(min)
  if (isNaN(m)) return String(min)
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? `${h}h ${r}m` : `${r}m`
}

export function isToday(v) {
  const d = toDate(v)
  if (!d) return false
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

export function statusTone(status) {
  const s = normStatus(status)
  if (['completed', 'complete', 'done', 'approved', 'active', 'good', 'available', 'best'].includes(s)) return 'b-green'
  if (['assigned', 'pending', 'planned', 'in_progress', 'inprogress', 'progress', 'scheduled', 'open'].includes(s)) return 'b-amber'
  if (['delayed', 'overdue', 'critical', 'poor', 'cancelled', 'canceled', 'rejected', 'failed'].includes(s)) return 'b-red'
  if (['review', 'under_review'].includes(s)) return 'b-blue'
  return 'b-gray'
}

export function initials(name, email) {
  const src = name || email || 'W'
  const parts = String(src).trim().split(/\s+/)
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

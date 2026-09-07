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
    if (v.seconds !== undefined && v.seconds !== null) return new Date(Number(v.seconds) * 1000)
    if (v._seconds !== undefined && v._seconds !== null) return new Date(Number(v._seconds) * 1000)
    if (typeof v === 'number') return new Date(v)
    const str = String(v).trim()
    const secMatch = str.match(/['"]?seconds['"]?\s*:\s*(\d+)/i)
    if (secMatch) {
      return new Date(Number(secMatch[1]) * 1000)
    }
    if (/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(str)) {
      const parts = str.split(':')
      const now = new Date()
      now.setHours(Number(parts[0]), Number(parts[1]), Number(parts[2] || 0), 0)
      return now
    }
    const d = new Date(str.includes('T') ? str : str.replace(' ', 'T'))
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function fmtDate(v) {
  if (!v) return '—'
  const str = String(v).trim()
  if (/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(str)) {
    return `${str} hrs`
  }
  const d = toDate(v)
  if (d) {
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }
  if (str.startsWith('{') && str.endsWith('}')) return '—'
  return String(v)
}

export function fmtDateOnly(v) {
  if (!v) return '—'
  const str = String(v).trim()
  if (/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(str)) {
    return 'Scheduled'
  }
  const d = toDate(v)
  if (d) {
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  if (str.startsWith('{') && str.endsWith('}')) return '—'
  return String(v)
}

export function fmtDurationMin(min) {
  if (min === undefined || min === null || min === '') return '—'
  const m = Number(min)
  if (isNaN(m)) return String(min)
  const h = Math.floor(m / 60)
  const r = m % 60
  return h ? `${h}h ${r}m` : `${r}m`
}

export function statusTone(status) {
  const s = normStatus(status)
  if (['completed', 'complete', 'done', 'approved', 'active', 'good', 'available', 'best'].includes(s)) return 'b-green'
  if (['assigned', 'pending', 'planned', 'proposed', 'draft', 'in_progress', 'inprogress', 'progress', 'scheduled', 'open', 'alternative'].includes(s)) return 'b-amber'
  if (['delayed', 'overdue', 'critical', 'poor', 'cancelled', 'canceled', 'rejected', 'failed', 'low'].includes(s)) return 'b-red'
  if (['review', 'under_review'].includes(s)) return 'b-blue'
  return 'b-gray'
}

export function initials(name, email) {
  const src = name || email || 'S'
  const parts = String(src).trim().split(/\s+/)
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

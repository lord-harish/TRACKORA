import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, pick, toDate } from '../utils/format.js'

export default function TrainMovements() {
  const { rows, loading, unavailable } = useCollection('train_movements', { max: 1000 })
  const [q, setQ] = useState('')
  const [date, setDate] = useState('')
  const [section, setSection] = useState('all')
  const [type, setType] = useState('all')
  const [status, setStatus] = useState('all')

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const facets = useMemo(() => ({
    sections: [...new Set(rows.map((r) => pick(r, 'section', 'corridor', 'route')).filter(Boolean))],
    types: [...new Set(rows.map((r) => pick(r, 'train_type', 'trainType', 'type', 'category')).filter(Boolean))],
    statuses: [...new Set(rows.map((r) => pick(r, 'status', 'current_status')).filter(Boolean))],
  }), [rows])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (section !== 'all' && pick(r, 'section', 'corridor', 'route') !== section) return false
      if (type !== 'all' && pick(r, 'train_type', 'trainType', 'type', 'category') !== type) return false
      if (status !== 'all' && pick(r, 'status', 'current_status') !== status) return false
      if (date) {
        const d = toDate(pick(r, 'entry_time', 'entryTime', 'date', 'scheduled_date'))
        if (!d || d.toISOString().slice(0, 10) !== date) return false
      }
      if (!needle) return true
      return [r.id, pick(r, 'train_number', 'trainNumber', 'train_no'), pick(r, 'section'), pick(r, 'direction')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, date, section, type, status])

  return (
    <div>
      <div className="page-head">
        <div><h2>Train Movements</h2><p>Section traffic, priorities and expected delay impact.</p></div>
      </div>

      <div className="toolbar">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Filter by date" />
        <select className="input" value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="all">All sections</option>
          {facets.sections.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All train types</option>
          {facets.types.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {facets.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(date || section !== 'all' || type !== 'all' || status !== 'all') && (
          <button className="btn btn-sm" onClick={() => { setDate(''); setSection('all'); setType('all'); setStatus('all') }}>Clear</button>
        )}
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} movements</span>
      </div>

      {loading ? <div className="card"><Loading rows={6} /></div>
      : unavailable ? <div className="card"><Unavailable collection="train_movements" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No train movements" hint={rows.length === 0 ? 'Data unavailable in database' : 'No movements match these filters.'} /></div>
      : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr>
              <th>Train</th><th>Type</th><th>Section</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Priority</th><th>Delay impact</th><th>Status</th>
            </tr></thead>
            <tbody>
              {filtered.slice(0, 300).map((r) => (
                <tr key={r.id}>
                  <td className="id">{pick(r, 'train_number', 'trainNumber', 'train_no', 'number') || r.id}</td>
                  <td>{pick(r, 'train_type', 'trainType', 'type', 'category') || '—'}</td>
                  <td>{pick(r, 'section', 'corridor', 'route') || '—'}</td>
                  <td>{pick(r, 'direction') || '—'}</td>
                  <td className="muted">{fmtDate(pick(r, 'entry_time', 'entryTime', 'entry'))}</td>
                  <td className="muted">{fmtDate(pick(r, 'exit_time', 'exitTime', 'exit'))}</td>
                  <td><Badge value={pick(r, 'priority')} /></td>
                  <td>{pick(r, 'expected_delay_impact', 'delay_impact', 'expectedDelay', 'delay_min') != null ? `${pick(r, 'expected_delay_impact', 'delay_impact', 'expectedDelay', 'delay_min')} min` : '—'}</td>
                  <td><Badge value={pick(r, 'status', 'current_status')} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

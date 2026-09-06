import { useEffect, useMemo, useState } from 'react'
import { useCollection } from '../hooks/useCollection.js'
import { Badge, EmptyState, Loading, Unavailable } from '../components/ui.jsx'
import { fmtDate, normStatus, pick } from '../utils/format.js'

const CATEGORIES = ['all', 'Track', 'Signal', 'OHE']

export default function Assets() {
  const { rows, loading, unavailable } = useCollection('assets', { max: 1000 })
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('all')
  const [crit, setCrit] = useState('all')
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const fn = (e) => setQ(e.detail || '')
    window.addEventListener('trackora:search', fn)
    return () => window.removeEventListener('trackora:search', fn)
  }, [])

  const matchCat = (r, c) => {
    const v = `${pick(r, 'asset_type', 'assetType', 'type', 'category') || ''}`.toLowerCase()
    if (c === 'Track') return v.includes('track')
    if (c === 'Signal') return v.includes('signal') || v.includes('s&t') || v.includes('snt')
    if (c === 'OHE') return v.includes('ohe') || v.includes('traction') || v.includes('oh')
    return true
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter((r) => {
      if (cat !== 'all' && !matchCat(r, cat)) return false
      if (crit !== 'all' && normStatus(pick(r, 'criticality', 'condition', 'risk_level')) !== crit) return false
      if (!needle) return true
      return [r.id, pick(r, 'asset_id'), pick(r, 'asset_type'), pick(r, 'section'), pick(r, 'department')]
        .filter(Boolean).join(' ').toLowerCase().includes(needle)
    })
  }, [rows, q, cat, crit])

  return (
    <div>
      <div className="page-head">
        <div><h2>Assets Management</h2><p>Track · Signal/S&T · OHE/Traction — search, filter and inspect.</p></div>
      </div>

      <div className="toolbar">
        <div className="seg">
          {CATEGORIES.map((c) => (
            <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c === 'all' ? 'All' : c}</button>
          ))}
        </div>
        <select className="input" value={crit} onChange={(e) => setCrit(e.target.value)}>
          <option value="all">All conditions</option>
          <option value="critical">Critical</option>
          <option value="poor">Poor</option>
          <option value="fair">Fair</option>
          <option value="good">Good</option>
        </select>
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} assets</span>
      </div>

      {loading ? <div className="card"><Loading rows={6} /></div>
      : unavailable ? <div className="card"><Unavailable collection="assets" /></div>
      : filtered.length === 0 ? <div className="card"><EmptyState title="No assets" hint={rows.length === 0 ? 'Data unavailable in database' : 'No assets match these filters.'} /></div>
      : (
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>Asset ID</th><th>Type</th><th>Dept</th><th>Section</th><th>KM</th><th>Criticality</th><th>Condition</th><th>Status</th><th>Last inspection</th><th></th></tr></thead>
            <tbody>
              {filtered.slice(0, 300).map((r) => {
                const tone = normStatus(pick(r, 'criticality', 'condition'))
                const hot = ['critical', 'poor'].includes(tone)
                return (
                  <tr key={r.id} style={hot ? { background: '#fff7f6' } : undefined}>
                    <td className="id">{pick(r, 'asset_id', 'assetId') || r.id}</td>
                    <td>{pick(r, 'asset_type', 'assetType', 'type', 'category') || '—'}</td>
                    <td>{pick(r, 'department', 'dept') || '—'}</td>
                    <td>{pick(r, 'section', 'location') || '—'}</td>
                    <td className="mono">{pick(r, 'km', 'km_location', 'chainage') ?? '—'}</td>
                    <td><Badge value={pick(r, 'criticality', 'risk_level')} /></td>
                    <td><Badge value={pick(r, 'condition', 'health')} /></td>
                    <td><Badge value={pick(r, 'status')} /></td>
                    <td className="muted">{fmtDate(pick(r, 'last_inspection', 'lastInspection', 'inspected_at'))}</td>
                    <td><button className="btn btn-sm" onClick={() => setSelected(r)}>View</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>{pick(selected, 'asset_id') || selected.id}</h3>
              <button className="iconbtn" onClick={() => setSelected(null)}>✕</button>
            </div>
            <p className="muted">{pick(selected, 'asset_type', 'type') || 'Asset detail'}</p>
            <dl className="kv">
              <dt>Type</dt><dd>{pick(selected, 'asset_type', 'assetType', 'type', 'category') || '—'}</dd>
              <dt>Department</dt><dd>{pick(selected, 'department', 'dept') || '—'}</dd>
              <dt>Section</dt><dd>{pick(selected, 'section', 'location') || '—'}</dd>
              <dt>KM location</dt><dd>{pick(selected, 'km', 'km_location', 'chainage') ?? '—'}</dd>
              <dt>Criticality</dt><dd><Badge value={pick(selected, 'criticality', 'risk_level')} /></dd>
              <dt>Condition</dt><dd><Badge value={pick(selected, 'condition', 'health')} /></dd>
              <dt>Status</dt><dd><Badge value={pick(selected, 'status')} /></dd>
              <dt>Last inspection</dt><dd>{fmtDate(pick(selected, 'last_inspection', 'lastInspection', 'inspected_at'))}</dd>
            </dl>
            {['critical', 'poor'].includes(normStatus(pick(selected, 'criticality', 'condition'))) && (
              <div className="alert alert-err">Critical / poor-condition asset — prioritise inspection and block planning.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

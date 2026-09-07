import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { Card, Loading } from '../components/ui.jsx'
import { pick } from '../utils/format.js'
import { updateDocFields } from '../services/firestoreService.js'

export default function Profile() {
  const { user, profile, authLoading } = useAuth()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.name || profile?.display_name || '')
  const [phone, setPhone] = useState(profile?.phone || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const patch = {}
      if (name.trim()) {
        if (profile?.display_name !== undefined) patch.display_name = name.trim()
        else patch.name = name.trim()
      }
      if (phone.trim()) patch.phone = phone.trim()
      await updateDocFields('users', user.uid, patch)
      setMsg({ ok: true, text: 'Profile updated.' })
      setEditing(false)
    } catch (err) {
      setMsg({ ok: false, text: err.message || 'Could not update profile.' })
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <div className="card"><Loading rows={4} /></div>

  return (
    <div>
      <div className="page-head">
        <div><h2>Profile</h2><p>Your account and work information.</p></div>
        {!editing && <button className="btn" onClick={() => { setName(profile?.name || profile?.display_name || ''); setPhone(profile?.phone || ''); setEditing(true) }}>Edit</button>}
      </div>

      {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-err'}`}>{msg.text}</div>}

      <Card title="Account">
        <dl className="kv">
          <dt>Name</dt><dd>{profile?.name || profile?.display_name || '—'}</dd>
          <dt>Email</dt><dd>{user?.email || pick(profile, 'email') || '—'}</dd>
          <dt>Role</dt><dd>{pick(profile, 'role') || 'staff'}</dd>
          <dt>User ID</dt><dd className="mono">{user?.uid || profile?.id || '—'}</dd>
        </dl>
      </Card>

      <div style={{ height: 14 }}></div>

      <Card title="Work information" sub="Department and section are managed by Admin">
        <dl className="kv">
          <dt>Department</dt><dd>{pick(profile, 'department', 'dept', 'team') || '—'}</dd>
          <dt>Section</dt><dd>{pick(profile, 'section', 'assigned_section', 'location') || '—'}</dd>
          <dt>Phone</dt><dd>{pick(profile, 'phone', 'phone_number', 'contact') || '—'}</dd>
        </dl>
      </Card>

      {editing && (
        <div>
          <div style={{ height: 14 }}></div>
          <Card title="Edit basic info" sub="Only name and phone can be changed here.">
            <form onSubmit={save} style={{ display: 'grid', gap: 12 }}>
              <div className="field">
                <label htmlFor="pf-name">Name</label>
                <input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="pf-phone">Phone</label>
                <input id="pf-phone" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="row">
                <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save changes'}</button>
                <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { subscribeCollection } from '../services/firestoreService.js'

// Generic hook: returns { rows, loading, unavailable }.
// Real-time listener via onSnapshot, updating automatically when database changes.
// Renders must show "Data unavailable in database" when unavailable === true.
export function useCollection(name, options) {
  const key = JSON.stringify({ name, options })
  const [state, setState] = useState({ rows: [], loading: true, unavailable: false })

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))

    const unsub = subscribeCollection(
      name,
      options,
      ({ rows, unavailable }) => {
        if (alive) {
          setState({ rows, loading: false, unavailable })
        }
      },
      () => {
        if (alive) {
          setState((s) => ({ ...s, loading: false }))
        }
      }
    )

    return () => {
      alive = false
      if (typeof unsub === 'function') unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}

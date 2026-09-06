import { useEffect, useState } from 'react'
import { fetchCollection } from '../services/firestoreService.js'

export function useCollection(name, options) {
  const key = JSON.stringify({ name, options })
  const [state, setState] = useState({ rows: [], loading: true, unavailable: false })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true }))
    fetchCollection(name, options)
      .then(({ rows, unavailable }) => {
        if (alive) setState({ rows, loading: false, unavailable })
      })
      .catch(() => {
        if (alive) setState({ rows: [], loading: false, unavailable: true })
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}

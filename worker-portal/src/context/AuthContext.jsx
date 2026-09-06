import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, isFirebaseConfigured } from '../firebase.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [roleLoading, setRoleLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setAuthLoading(false)
      return
    }
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setAuthError('')
      if (!fbUser) {
        setUser(null)
        setProfile(null)
        setAuthLoading(false)
        return
      }
      setRoleLoading(true)
      try {
        // Role verification: users/{uid} must have role === 'worker'
        const snap = await getDoc(doc(db, 'users', fbUser.uid))
        if (!snap.exists()) {
          await signOut(auth)
          setUser(null)
          setProfile(null)
          setAuthError('No worker profile found for this account. Contact your supervisor.')
        } else {
          const data = snap.data()
          const role = String(data.role || data.user_role || '').toLowerCase()
          if (role !== 'worker') {
            await signOut(auth)
            setUser(null)
            setProfile(null)
            setAuthError('Access denied: this portal is restricted to worker users.')
          } else {
            setUser(fbUser)
            setProfile({ id: snap.id, ...data })
          }
        }
      } catch (e) {
        console.error(e)
        await signOut(auth).catch(() => {})
        setUser(null)
        setProfile(null)
        setAuthError('Could not verify worker role. Check Firestore rules / users collection.')
      } finally {
        setRoleLoading(false)
        setAuthLoading(false)
      }
    })
    return () => unsub()
  }, [])

  const login = async (email, password) => {
    setAuthError('')
    if (!isFirebaseConfigured) throw new Error('Firebase is not configured. Fill the .env file first.')
    await signInWithEmailAndPassword(auth, email.trim(), password)
  }

  const logout = async () => {
    if (auth) await signOut(auth)
    setUser(null)
    setProfile(null)
  }

  const value = useMemo(
    () => ({ user, profile, authLoading, roleLoading, authError, setAuthError, login, logout, isFirebaseConfigured }),
    [user, profile, authLoading, roleLoading, authError]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}

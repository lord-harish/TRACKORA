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
        // Role verification: check 'users/{uid}' first, then fallback to 'USER001/{uid}'
        let snap = await getDoc(doc(db, 'users', fbUser.uid))
        if (!snap.exists()) {
          // Check USER001 fallback in case Firestore collection was named USER001
          const fallbackSnap = await getDoc(doc(db, 'USER001', fbUser.uid))
          if (fallbackSnap.exists()) {
            snap = fallbackSnap
          }
        }

        if (!snap.exists()) {
          await signOut(auth)
          setUser(null)
          setProfile(null)
          setAuthError(
            `No admin profile found for UID "${fbUser.uid}". Create a document in the "users" collection with this UID and role="admin".`
          )
        } else {
          const data = snap.data()
          const role = String(data.role || data.user_role || '').toLowerCase()
          if (role !== 'admin') {
            await signOut(auth)
            setUser(null)
            setProfile(null)
            setAuthError(`Access denied: role is "${role || 'undefined'}" but must be "admin".`)
          } else {
            setUser(fbUser)
            setProfile({ id: snap.id, ...data })
          }
        }
      } catch (e) {
        console.error('[AuthContext] Role verification error:', e)
        await signOut(auth).catch(() => {})
        setUser(null)
        setProfile(null)
        if (e?.code === 'permission-denied') {
          setAuthError('Permission Denied: Please update your Firestore Security Rules in Firebase Console (Cloud Firestore > Rules) to allow reads.')
        } else {
          setAuthError(`Role check failed: ${e?.message || 'Check Firestore rules and users collection.'}`)
        }
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
    // role check happens in onAuthStateChanged
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

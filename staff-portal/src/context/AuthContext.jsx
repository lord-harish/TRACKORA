import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
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
        let userDocData = null
        let userDocId = null

        // Strategy 1: check doc 'users/{uid}'
        const snap = await getDoc(doc(db, 'users', fbUser.uid))
        if (snap.exists()) {
          userDocId = snap.id
          userDocData = snap.data()
        }

        // Strategy 2: query 'users' by email
        if (!userDocData && fbUser.email) {
          const emailQ = await getDocs(query(collection(db, 'users'), where('email', '==', fbUser.email.trim().toLowerCase()), limit(1)))
          if (!emailQ.empty) {
            userDocId = emailQ.docs[0].id
            userDocData = emailQ.docs[0].data()
          } else {
            const rawEmailQ = await getDocs(query(collection(db, 'users'), where('email', '==', fbUser.email.trim()), limit(1)))
            if (!rawEmailQ.empty) {
              userDocId = rawEmailQ.docs[0].id
              userDocData = rawEmailQ.docs[0].data()
            }
          }
        }

        // Strategy 3: check fallback docs
        if (!userDocData) {
          for (const candId of ['USER002', 'STAFF001', 'STAFF01']) {
            const s = await getDoc(doc(db, 'users', candId))
            if (s.exists()) {
              userDocId = s.id
              userDocData = s.data()
              break
            }
          }
        }

        // Strategy 4: If staff email or demo account, auto-provision
        if (!userDocData && fbUser.email) {
          const em = fbUser.email.toLowerCase()
          if (em.includes('staff') || em === '20harish01@gmail.com') {
            const initialProfile = {
              uid: fbUser.uid,
              email: fbUser.email,
              name: fbUser.displayName || 'Operations Staff',
              role: em === '20harish01@gmail.com' ? 'admin' : 'staff',
              department: 'Civil Engineering / Maintenance',
              active: true,
              employee_id: 'STF-001',
              created_at: serverTimestamp(),
              updated_at: serverTimestamp(),
            }
            try {
              await setDoc(doc(db, 'users', fbUser.uid), initialProfile)
              userDocId = fbUser.uid
              userDocData = initialProfile
            } catch (err) {
              console.warn('[Staff AuthContext] Auto-provision fallback:', err.message)
            }
          }
        }

        if (!userDocData) {
          await signOut(auth)
          setUser(null)
          setProfile(null)
          setAuthError('No staff profile found for this account. Contact your administrator.')
        } else {
          const role = String(userDocData.role || userDocData.user_role || userDocData.userRole || '').toLowerCase()
          // Staff portal allows staff and admin supervisors
          if (role !== 'staff' && role !== 'admin' && role !== 'administrator') {
            await signOut(auth)
            setUser(null)
            setProfile(null)
            setAuthError('Access denied: this portal is restricted to staff users.')
          } else {
            setUser(fbUser)
            setProfile({ id: userDocId, ...userDocData })
          }
        }
      } catch (e) {
        console.error('[Staff AuthContext] Role verification error:', e)
        await signOut(auth).catch(() => {})
        setUser(null)
        setProfile(null)
        if (e?.code === 'permission-denied') {
          setAuthError('Permission Denied: Please check Firestore Security Rules to allow reads for authenticated users.')
        } else {
          setAuthError(`Could not verify staff role: ${e?.message || 'Check users collection.'}`)
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

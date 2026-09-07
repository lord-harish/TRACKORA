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

        // Strategy 3: check doc 'users/USER001' or collection 'USER001'
        if (!userDocData) {
          const user001Snap = await getDoc(doc(db, 'users', 'USER001'))
          if (user001Snap.exists()) {
            userDocId = user001Snap.id
            userDocData = user001Snap.data()
          } else {
            const collUser001 = await getDoc(doc(db, 'USER001', fbUser.uid))
            if (collUser001.exists()) {
              userDocId = collUser001.id
              userDocData = collUser001.data()
            }
          }
        }

        // Strategy 4: If still no profile, but account is administrator (e.g. 20harish01@gmail.com or admin email), auto-provision profile
        if (!userDocData && fbUser.email) {
          const emailLower = fbUser.email.toLowerCase()
          if (emailLower === '20harish01@gmail.com' || emailLower.includes('admin')) {
            const initialProfile = {
              uid: fbUser.uid,
              email: fbUser.email,
              name: fbUser.displayName || 'System Administrator',
              role: 'admin',
              department: 'Rail Administration',
              active: true,
              employee_id: 'ADM-001',
              created_at: serverTimestamp(),
              updated_at: serverTimestamp(),
            }
            try {
              await setDoc(doc(db, 'users', fbUser.uid), initialProfile)
              userDocId = fbUser.uid
              userDocData = initialProfile
            } catch (createErr) {
              console.warn('[AuthContext] Auto-provision admin profile fallback:', createErr.message)
            }
          }
        }

        if (!userDocData) {
          await signOut(auth)
          setUser(null)
          setProfile(null)
          setAuthError(
            `No admin profile found for UID "${fbUser.uid}". Create a document in the "users" collection with this UID and role="admin".`
          )
        } else {
          const role = String(userDocData.role || userDocData.user_role || userDocData.userRole || '').toLowerCase()
          if (role !== 'admin' && role !== 'administrator' && role !== 'superadmin') {
            await signOut(auth)
            setUser(null)
            setProfile(null)
            setAuthError(`Access denied: role is "${role || 'undefined'}" but must be "admin".`)
          } else {
            setUser(fbUser)
            setProfile({ id: userDocId, ...userDocData })
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

// Firebase initialisation — all keys come from environment variables.
// See .env.example. No keys are hardcoded.
import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId)

let app = null
let auth = null
let db = null

if (isFirebaseConfigured) {
  app = initializeApp(config)
  auth = getAuth(app)
  db = getFirestore(app)
} else {
  console.warn(
    '[TRACKORA] Firebase env vars missing. Fill admin-portal/.env (see .env.example). Data will show as unavailable until configured.'
  )
}

export { app, auth, db }

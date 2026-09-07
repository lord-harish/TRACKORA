/**
 * seed_database.mjs
 * =================
 * Seeds or verifies the 13 operational collections defined in
 * TRACKORA Complete Application Logic.md:
 *
 *  1. users
 *  2. assets
 *  3. maintenance_tasks
 *  4. train_movements
 *  5. goods_forecasts
 *  6. corridor_blocks
 *  7. weather
 *  8. candidate_windows
 *  9. block_plans
 * 10. plan_versions
 * 11. work_assignments
 * 12. status_updates
 * 13. audit_logs
 *
 * Usage:
 *   cd admin-portal
 *   node scripts/seed_database.mjs [email] [password]
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  serverTimestamp,
  limit,
  query
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.VITE_FIREBASE_API_KEY || "AIzaSyCUORsF8LXZdDJhvgFjmYYtL9m3OkGmbxw",
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || "trackora-9969.firebaseapp.com",
  projectId: process.env.VITE_FIREBASE_PROJECT_ID || "trackora-9969",
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET || "trackora-9969.firebasestorage.app",
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "708254526317",
  appId: process.env.VITE_FIREBASE_APP_ID || "1:708254526317:web:a8c1a99cbd546768e4c864",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Seed data definitions matching TRACKORA Complete Application Logic.md
const SAMPLE_CORRIDOR_BLOCKS = [
  {
    block_id: 'BLK001',
    section: 'CBE-SLM',
    start_time: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T01:00:00Z',
    end_time: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T04:00:00Z',
    duration_min: 180,
    available: true,
    restrictions: 'Night window only',
    max_duration_min: 240,
  },
  {
    block_id: 'BLK002',
    section: 'MAS-AJJ',
    start_time: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T11:00:00Z',
    end_time: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T13:30:00Z',
    duration_min: 150,
    available: true,
    restrictions: 'Single line working permitted',
    max_duration_min: 180,
  },
  {
    block_id: 'BLK003',
    section: 'SA-ED',
    start_time: new Date(Date.now() + 86400000).toISOString().slice(0, 10) + 'T22:00:00Z',
    end_time: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10) + 'T01:00:00Z',
    duration_min: 180,
    available: true,
    restrictions: 'Freight detour required',
    max_duration_min: 210,
  },
];

const SAMPLE_TRAIN_MOVEMENTS = [
  {
    train_id: 'TRN-12675',
    train_number: '12675',
    train_name: 'Kovai Express',
    train_type: 'Express Passenger',
    section: 'MAS-AJJ',
    direction: 'Down',
    entry_time: '06:10',
    exit_time: '07:15',
    priority: 1,
    expected_delay_impact: 'High',
    status: 'scheduled',
  },
  {
    train_id: 'TRN-22639',
    train_number: '22639',
    train_name: 'Alleppey Express',
    train_type: 'Superfast',
    section: 'CBE-SLM',
    direction: 'Up',
    entry_time: '23:45',
    exit_time: '01:30',
    priority: 1,
    expected_delay_impact: 'Critical',
    status: 'scheduled',
  },
  {
    train_id: 'TRN-56321',
    train_number: '56321',
    train_name: 'Salem Passenger',
    train_type: 'Passenger',
    section: 'SA-ED',
    direction: 'Up',
    entry_time: '14:20',
    exit_time: '15:40',
    priority: 3,
    expected_delay_impact: 'Low',
    status: 'scheduled',
  },
];

const SAMPLE_GOODS_FORECASTS = [
  {
    forecast_id: 'GF-001',
    section: 'CBE-SLM',
    forecast_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    start_time: '02:00',
    end_time: '05:00',
    probability: 0.65,
    expected_train_count: 2,
    confidence: 'high',
  },
  {
    forecast_id: 'GF-002',
    section: 'MAS-AJJ',
    forecast_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    start_time: '12:00',
    end_time: '14:00',
    probability: 0.35,
    expected_train_count: 1,
    confidence: 'medium',
  },
];

const SAMPLE_WEATHER = [
  {
    weather_id: 'WX-CBE-01',
    section: 'CBE-SLM',
    forecast_time: new Date(Date.now() + 86400000).toISOString(),
    rainfall_mm: 0.5,
    visibility_km: 10.0,
    wind_speed_kmh: 12.0,
    condition: 'clear',
    maintenance_suitable: true,
  },
  {
    weather_id: 'WX-MAS-01',
    section: 'MAS-AJJ',
    forecast_time: new Date(Date.now() + 86400000).toISOString(),
    rainfall_mm: 2.0,
    visibility_km: 8.5,
    wind_speed_kmh: 15.0,
    condition: 'light_clouds',
    maintenance_suitable: true,
  },
];

export async function verifyAndSeedCollections(userEmail = 'admin@trackora.rail') {
  console.log('--- TRACKORA Collections Verification & Seeding ---');
  console.log('Project:', firebaseConfig.projectId);

  const collectionsToCheck = [
    { name: 'corridor_blocks', samples: SAMPLE_CORRIDOR_BLOCKS, idKey: 'block_id' },
    { name: 'train_movements', samples: SAMPLE_TRAIN_MOVEMENTS, idKey: 'train_id' },
    { name: 'goods_forecasts', samples: SAMPLE_GOODS_FORECASTS, idKey: 'forecast_id' },
    { name: 'weather', samples: SAMPLE_WEATHER, idKey: 'weather_id' },
  ];

  for (const c of collectionsToCheck) {
    try {
      const snap = await getDocs(query(collection(db, c.name), limit(5)));
      console.log(`[${c.name}] Current count: ${snap.size}`);
      if (snap.empty && c.samples) {
        console.log(`  -> Seeding ${c.samples.length} records into ${c.name}...`);
        for (const item of c.samples) {
          await addDoc(collection(db, c.name), {
            ...item,
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
          });
        }
        console.log(`  ✓ ${c.name} seeded successfully.`);
      }
    } catch (e) {
      console.warn(`[${c.name}] Check/Seed error:`, e.message);
    }
  }

  // Audit log entry
  try {
    await addDoc(collection(db, 'audit_logs'), {
      timestamp: serverTimestamp(),
      created_at: serverTimestamp(),
      user: userEmail,
      user_email: userEmail,
      action: 'database_verification',
      entity_type: 'database',
      entity_id: 'trackora-9969',
      previous_status: '',
      new_status: 'verified',
      details: 'Automated verification of operational collections',
    });
    console.log('[audit_logs] Verification logged successfully.');
  } catch (e) {
    console.warn('[audit_logs] Log error:', e.message);
  }

  console.log('--- Verification & Seeding Complete ---');
}

// Auto-run if executed directly via node
const [emailArg, pwArg] = process.argv.slice(2);
if (emailArg && pwArg) {
  console.log(`Signing in as ${emailArg}...`);
  signInWithEmailAndPassword(auth, emailArg, pwArg)
    .then((cred) => {
      console.log('Authenticated UID:', cred.user.uid);
      return verifyAndSeedCollections(cred.user.email);
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Authentication or seed failed:', err.message);
      process.exit(1);
    });
} else {
  console.log('Run with credentials to authenticate and write (e.g. node seed_database.mjs <email> <password>)');
}

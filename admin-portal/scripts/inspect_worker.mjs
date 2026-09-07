import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const config = {
  apiKey: "AIzaSyCUORsF8LXZdDJhvgFjmYYtL9m3OkGmbxw",
  authDomain: "trackora-9969.firebaseapp.com",
  projectId: "trackora-9969",
  storageBucket: "trackora-9969.firebasestorage.app",
  messagingSenderId: "708254526317",
  appId: "1:708254526317:web:a8c1a99cbd546768e4c864",
};

const app = initializeApp(config);
const db = getFirestore(app);

async function inspect() {
  console.log('=== USERS ===');
  const usersSnap = await getDocs(collection(db, 'users'));
  usersSnap.forEach(d => {
    console.log(d.id, '=>', JSON.stringify(d.data()));
  });

  console.log('\n=== WORK ASSIGNMENTS ===');
  const asgSnap = await getDocs(collection(db, 'work_assignments'));
  asgSnap.forEach(d => {
    console.log(d.id, '=>', JSON.stringify(d.data()));
  });

  console.log('\n=== MAINTENANCE TASKS ===');
  const taskSnap = await getDocs(collection(db, 'maintenance_tasks'));
  taskSnap.forEach(d => {
    console.log(d.id, '=>', JSON.stringify(d.data()));
  });
}

inspect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

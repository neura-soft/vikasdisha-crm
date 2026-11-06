import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: 'AIzaSyAo_nEsyfew5VYy1eWrNyM_wmZvlctWQR0',
  authDomain: 'vikasdisha.firebaseapp.com',
  projectId: 'vikasdisha',
  storageBucket: 'vikasdisha.firebasestorage.app',
  messagingSenderId: '172892993129',
  appId: '1:172892993129:android:04629c0508f9ad657414f8',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'asia-south1');

// CRM names used by the web application. Keep the Expo-compatible exports above
// so this config can also be copied directly from expo-app/firebase.ts.
export const firebaseAuth = auth;
export const firestore = db;
export const isFirebaseConfigured = true;

export default app;

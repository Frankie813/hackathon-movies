// firebase.ts — the single Firebase entry point for the app (issue #2).
//
// The EXPO_PUBLIC_FIREBASE_* values are public by design: the web config ships
// in every Firebase client bundle and is protected by Firestore rules, not by
// secrecy. Real secrets (ElevenLabs, TMDB write) must never pass through here —
// they belong in the `tts` Cloud Function / Express proxy. See AGENTS.md §3.
//
// Requires (install once the Expo app from #1 exists):
//   npx expo install firebase @react-native-async-storage/async-storage

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
  type Auth,
} from 'firebase/auth';
import { doc, getDoc, getFirestore, type Firestore } from 'firebase/firestore';

// Expo's babel plugin inlines `process.env.EXPO_PUBLIC_*` only when it is
// written out literally — a dynamic `process.env[key]` lookup resolves to
// undefined at runtime. Keep these spelled out.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
} as const;

type FirebaseConfigKey = keyof typeof firebaseConfig;

function readConfig(): Record<FirebaseConfigKey, string> {
  const missing = (Object.keys(firebaseConfig) as FirebaseConfigKey[]).filter(
    (key) => !firebaseConfig[key],
  );

  if (missing.length > 0) {
    const vars = missing
      .map((key) => `EXPO_PUBLIC_FIREBASE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
      .join(', ');
    throw new Error(
      `Firebase config is incomplete. Missing: ${vars}. ` +
        'Copy .env.example to .env and fill in the web config from the Firebase console ' +
        '(Project settings → Your apps → Web app), then restart the bundler with --clear.',
    );
  }

  return firebaseConfig as Record<FirebaseConfigKey, string>;
}

// getApps() guard keeps Fast Refresh from re-initializing on every save.
export const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(readConfig());

function createAuth(instance: FirebaseApp): Auth {
  try {
    // AsyncStorage persistence keeps the anonymous uid across app restarts, so
    // a guest who backgrounds the app does not drop out of their group session.
    // Note: @react-native-async-storage/async-storage v3 replaces the default
    // export with createAsyncStorage('app') — update this call if #1 pulls v3.
    return initializeAuth(instance, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    // Already initialized (Fast Refresh re-ran this module) — reuse it.
    return getAuth(instance);
  }
}

export const auth: Auth = createAuth(app);

// Long-polling auto-detection has been the default since May 2023, so React
// Native needs no transport settings here.
export const db: Firestore = getFirestore(app);

/**
 * Proves the app can actually talk to Firestore. Reads a doc that is not
 * required to exist — resolving at all means auth, rules, and network are fine.
 * Requires a signed-in user; call it after ensureAnonymousUser().
 */
export async function checkFirestoreReachable(): Promise<boolean> {
  try {
    await getDoc(doc(db, 'health', 'ping'));
    return true;
  } catch (error) {
    console.warn('[firebase] Firestore unreachable:', error);
    return false;
  }
}

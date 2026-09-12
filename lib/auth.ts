// auth.ts — anonymous sign-in bootstrap (issue #2).
//
// Every guest is an anonymous Firebase user. There is no login screen anywhere
// in this app: the join flow (#16, #19) is zero-account by design, and the uid
// is what identifies a member inside sessions/{code}.

import {
  onAuthStateChanged,
  signInAnonymously,
  type User,
} from 'firebase/auth';
import { useEffect, useState } from 'react';

import { auth } from './firebase';

function waitForInitialAuthState(): Promise<User | null> {
  return new Promise<User | null>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
}

async function signIn(): Promise<User> {
  // Persisted sessions restore a uid here, so returning guests keep theirs.
  const restored = await waitForInitialAuthState();
  if (restored) {
    console.log('[auth] restored anonymous uid:', restored.uid);
    return restored;
  }

  const credential = await signInAnonymously(auth);
  console.log('[auth] signed in anonymously, uid:', credential.user.uid);
  return credential.user;
}

let pending: Promise<User> | null = null;

/**
 * Resolves to the current anonymous user, signing one in if needed.
 * Safe to call from several places at once — concurrent callers share one
 * sign-in. On failure the cached promise is dropped so a later call retries.
 */
export function ensureAnonymousUser(): Promise<User> {
  const current = auth.currentUser;
  if (current) return Promise.resolve(current);

  if (!pending) {
    pending = signIn();
    pending.catch(() => {
      pending = null;
    });
  }

  return pending;
}

export interface AnonymousAuthState {
  /** null until sign-in completes. */
  uid: string | null;
  isSigningIn: boolean;
  error: Error | null;
}

/**
 * Drives anonymous sign-in from the root layout and tracks the uid.
 * Mount it once (#1's root layout); read the uid anywhere via this hook.
 */
export function useAnonymousAuth(): AnonymousAuthState {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [error, setError] = useState<Error | null>(null);
  const [isSigningIn, setIsSigningIn] = useState<boolean>(auth.currentUser === null);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!cancelled) setUid(user?.uid ?? null);
    });

    ensureAnonymousUser()
      .then((user) => {
        if (cancelled) return;
        setUid(user.uid);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const failure = cause instanceof Error ? cause : new Error(String(cause));
        console.warn('[auth] anonymous sign-in failed:', failure.message);
        setError(failure);
      })
      .finally(() => {
        if (!cancelled) setIsSigningIn(false);
      });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { uid, isSigningIn, error };
}

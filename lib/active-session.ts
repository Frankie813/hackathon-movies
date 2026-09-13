// lib/active-session.ts — which group session this device is in.
//
// Three things need the same answer: the Group tab (which starts, joins and
// leaves sessions, #16), the Swipe tab (which records every swipe into the
// session so #17 can rank the group) and the match watcher that mounts over
// every tab (#17, #10). Bottom-tab screens stay mounted, so a module-level
// value plus subscribers is enough — no context provider, no store.
//
// The code is persisted so a reload comes back into the same session, which
// is also the cheapest way to see that rejoin keeps your swipes (#16 step 5).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const ACTIVE_CODE_KEY = 'moviematch.activeSessionCode';

type Listener = (code: string | null) => void;

let current: string | null = null;
/**
 * True once the persisted value has been read *or* a caller has made an
 * explicit choice. A choice made while the read is still in flight wins: a
 * guest who scanned a QR means to be in *that* group, not the one from the
 * last rehearsal.
 */
let settled = false;
let hydrating: Promise<string | null> | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) {
    // A throwing subscriber must not stop the others from hearing the change.
    try {
      listener(current);
    } catch (cause) {
      console.warn('[session] active-code listener threw:', cause);
    }
  }
}

/** The session this device is in right now, or null. Synchronous; safe on the render path. */
export function getActiveCode(): string | null {
  return current;
}

/**
 * Restores the persisted code. Resolves to whatever the code is once the read
 * has landed — which may be a code set in the meantime rather than the stored
 * one. Later calls resolve immediately.
 */
export function hydrateActiveCode(): Promise<string | null> {
  if (settled) return Promise.resolve(current);
  if (!hydrating) {
    hydrating = AsyncStorage.getItem(ACTIVE_CODE_KEY)
      .catch((cause: unknown) => {
        console.warn('[session] could not read the active code:', cause);
        return null;
      })
      .then((stored) => {
        if (!settled) {
          settled = true;
          if (stored) {
            current = stored;
            notify();
          }
        }
        return current;
      });
  }
  return hydrating;
}

/**
 * Enters (or, with null, leaves) a session on this device. Persisting the code
 * is a convenience, not part of joining: a storage failure must not discard a
 * session that already exists in Firestore, so it is logged and nothing else.
 */
export function setActiveCode(code: string | null): void {
  settled = true;
  if (current === code) return;
  current = code;
  notify();

  const write = code
    ? AsyncStorage.setItem(ACTIVE_CODE_KEY, code)
    : AsyncStorage.removeItem(ACTIVE_CODE_KEY);
  write.catch((cause: unknown) => {
    console.warn('[session] could not persist the active code:', cause);
  });
}

/** @returns an unsubscribe. Call it on unmount or the listener leaks per remount. */
export function subscribeActiveCode(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export interface ActiveSessionState {
  code: string | null;
  /** False until the persisted code has been read; render nothing session-shaped before then. */
  ready: boolean;
}

/** The active code as React state. Mount anywhere; every instance sees the same value. */
export function useActiveCode(): ActiveSessionState {
  const [code, setCode] = useState<string | null>(current);
  const [ready, setReady] = useState(settled);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeActiveCode((next) => {
      if (!cancelled) setCode(next);
    });
    void hydrateActiveCode().then((restored) => {
      if (cancelled) return;
      setCode(restored);
      setReady(true);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { code, ready };
}

/** Test seam. Forgets the in-memory code and the hydration state, not the disk. */
export function __resetActiveCode(): void {
  current = null;
  settled = false;
  hydrating = null;
  listeners.clear();
}

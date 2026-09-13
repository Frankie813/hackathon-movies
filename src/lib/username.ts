// src/lib/username.ts — the display name shown on the UI, kept on-device only.
//
// This is deliberately separate from the anonymous uid (lib/auth.ts): the uid
// is what identifies a member to Firestore and stays private to the backend,
// while the username is cosmetic and has no uniqueness requirement — two
// guests in the same party can pick the same name.

import AsyncStorage from '@react-native-async-storage/async-storage';

const USERNAME_KEY = 'moviematch.username';

export const USERNAME_MAX_LENGTH = 24;

/** The stored display name, or null if one has never been set. Never throws. */
export async function getUsername(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(USERNAME_KEY);
    return value && value.trim().length > 0 ? value : null;
  } catch (cause) {
    console.warn('[username] could not read the stored username:', cause);
    return null;
  }
}

/** Persists a trimmed display name. A blank name is a no-op. Never throws. */
export async function setUsername(name: string): Promise<void> {
  const trimmed = name.trim().slice(0, USERNAME_MAX_LENGTH);
  if (!trimmed) return;
  try {
    await AsyncStorage.setItem(USERNAME_KEY, trimmed);
  } catch (cause) {
    console.warn('[username] could not save the username:', cause);
  }
}

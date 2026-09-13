import { useEffect, useState } from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect } from 'expo-router';
import { ScreenStub } from '@/components/ScreenStub';
import { useAnonymousAuth } from '@/lib/auth';

/** Set the first time Start is shown; every later launch skips straight to Swipe. */
const ONBOARDED_KEY = 'moviematch.onboarded';

export default function OnboardingScreen() {
  // null = still reading the flag; true = seen before, go to Swipe.
  const [seenBefore, setSeenBefore] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((value) => {
        if (cancelled) return;
        if (value) {
          setSeenBefore(true);
        } else {
          setSeenBefore(false);
          AsyncStorage.setItem(ONBOARDED_KEY, String(Date.now())).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setSeenBefore(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Surfacing the uid here makes #2's acceptance criteria checkable on a
  // physical device without tailing the Metro logs. Replaced by the real
  // onboarding deck in #9.
  const { uid, isSigningIn, error } = useAnonymousAuth();

  if (seenBefore === null) return <View style={{ flex: 1, backgroundColor: '#080d1a' }} />;
  if (seenBefore) return <Redirect href="/swipe" />;

  const authLine = error
    ? `Sign-in failed: ${error.message}`
    : isSigningIn
      ? 'Signing in…'
      : `Signed in anonymously as ${uid}`;

  return (
    <ScreenStub
      title="Onboarding"
      subtitle={`Polarizing deck goes here — seeds the taste vector (#9).\n\n${authLine}`}
    />
  );
}

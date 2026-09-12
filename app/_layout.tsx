import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useAnonymousAuth } from '@/lib/auth';
import { checkFirestoreReachable } from '@/lib/firebase';

export default function RootLayout() {
  // Anonymous sign-in starts here so every screen below can assume a uid (#2).
  const { uid } = useAnonymousAuth();

  useEffect(() => {
    if (!uid) return;
    void checkFirestoreReachable().then((reachable) => {
      console.log('[firebase] Firestore reachable:', reachable);
    });
  }, [uid]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </GestureHandlerRootView>
  );
}

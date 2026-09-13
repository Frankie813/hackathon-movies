import React from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { FloatingBubbleTabBar } from '@/components/FloatingBubbleTabBar';
import { MatchOverlay } from '@/components/MatchOverlay';

export default function TabsLayout() {
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        tabBar={(props) => <FloatingBubbleTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        {/* Start is the first-launch onboarding (#9): reachable on launch, never from the tab bar. */}
        <Tabs.Screen name="index" options={{ title: 'Start', href: null }} />
        <Tabs.Screen name="swipe" options={{ title: 'Swipe' }} />
        <Tabs.Screen name="group" options={{ title: 'Group' }} />
        <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
      </Tabs>

      {/* "It's a Match!" fires on every device in the session, whichever tab
          it is on (#17). Sits above the tab bar, so it is outside <Tabs>. */}
      <MatchOverlay />
    </View>
  );
}

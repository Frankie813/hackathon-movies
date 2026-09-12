import React from 'react';
import { Tabs } from 'expo-router';
import { FloatingBubbleTabBar } from '@/components/FloatingBubbleTabBar';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingBubbleTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Start' }} />
      <Tabs.Screen name="swipe" options={{ title: 'Swipe' }} />
      <Tabs.Screen name="group" options={{ title: 'Group' }} />
      <Tabs.Screen name="saved" options={{ title: 'Saved' }} />
    </Tabs>
  );
}

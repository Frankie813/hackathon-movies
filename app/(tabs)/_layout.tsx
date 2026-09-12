import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#e50914',
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Onboarding' }} />
      <Tabs.Screen name="swipe" options={{ title: 'Swipe' }} />
      <Tabs.Screen name="group" options={{ title: 'Group' }} />
    </Tabs>
  );
}

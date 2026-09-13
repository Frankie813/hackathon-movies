import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import type { Tabs } from 'expo-router';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  label: string;
  activeIcon: IconName;
  inactiveIcon: IconName;
}

const TAB_CONFIG: Record<string, TabConfig> = {
  index: {
    label: 'Start',
    activeIcon: 'sparkles',
    inactiveIcon: 'sparkles-outline',
  },
  swipe: {
    label: 'Swipe',
    activeIcon: 'flame',
    inactiveIcon: 'flame-outline',
  },
  group: {
    label: 'Group',
    activeIcon: 'people',
    inactiveIcon: 'people-outline',
  },
  saved: {
    label: 'Saved',
    activeIcon: 'bookmark',
    inactiveIcon: 'bookmark-outline',
  },
};

export type FloatingBubbleTabBarProps = Parameters<
  NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>
>[0];

export function FloatingBubbleTabBar({
  state,
  descriptors,
  navigation,
}: FloatingBubbleTabBarProps) {
  return (
    <View style={styles.floatingContainer} pointerEvents="box-none">
      <View style={styles.bubbleWrapper}>
        {/* Frosted Glass Backdrop Blur (Increased Transparency by 40%) */}
        {Platform.OS === 'ios' ? (
          <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.androidBackdrop]} />
        )}

        {/* Ambient Subtle Glass Highlight */}
        <View style={styles.innerGlassGlow} />

        {/* Tab Items */}
        <View style={styles.tabBarInner}>
          {state.routes
            // expo-router turns a screen's `href: null` into
            // tabBarItemStyle { display: 'none' } before the options reach a
            // custom tab bar, so that is the signal to leave it out.
            .filter(
              (route) =>
                StyleSheet.flatten(descriptors[route.key]?.options?.tabBarItemStyle)?.display !== 'none'
            )
            .map((route) => {
            const isFocused = state.routes[state.index]?.key === route.key;
            const config = TAB_CONFIG[route.name] || {
              label: route.name,
              activeIcon: 'film',
              inactiveIcon: 'film-outline',
            };

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={descriptors[route.key]?.options?.tabBarAccessibilityLabel || config.label}
                testID={descriptors[route.key]?.options?.tabBarButtonTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                style={({ pressed }) => [
                  styles.tabButton,
                  isFocused && styles.activeTabButton,
                  { transform: [{ scale: pressed ? 0.94 : 1 }] },
                ]}
              >
                <View style={styles.iconContainer}>
                  <Ionicons
                    name={isFocused ? config.activeIcon : config.inactiveIcon}
                    size={20}
                    color={isFocused ? '#f59e0b' : 'rgba(255, 255, 255, 0.65)'}
                    style={isFocused ? styles.activeIconGlow : undefined}
                  />
                  {isFocused && <View style={styles.activeDotIndicator} />}
                </View>
                <Text
                  style={[
                    styles.tabLabel,
                    isFocused ? styles.activeTabLabel : styles.inactiveTabLabel,
                  ]}
                  numberOfLines={1}
                >
                  {config.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  floatingContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    zIndex: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleWrapper: {
    width: '100%',
    maxWidth: 420,
    height: 64,
    borderRadius: 32,
    overflow: 'hidden',
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.16)',
    backgroundColor: 'rgba(8, 14, 26, 0.38)', // 40% more transparent base
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  androidBackdrop: {
    backgroundColor: 'rgba(10, 16, 30, 0.45)', // 40% increased transparency
  },
  innerGlassGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
  },
  tabBarInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
  },
  tabButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  activeTabButton: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.35)',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  activeIconGlow: {
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 8,
  },
  activeDotIndicator: {
    position: 'absolute',
    bottom: -3,
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#f59e0b',
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  activeTabLabel: {
    color: '#f59e0b',
  },
  inactiveTabLabel: {
    color: 'rgba(255, 255, 255, 0.65)',
  },
});

// __tests__/tab-bar-visibility.test.tsx — the tab bar is hidden on onboarding (#83).
//
// `href: null` on the Start screen only keeps it out of the bar's *items*; the
// bar itself is rendered for the whole (tabs) group, so onboarding still had a
// floating bar over it. The fix lives in the layout's `tabBar` render prop, so
// that is what this asserts: the prop is exercised directly with a navigation
// state, without mounting the navigator.

import React from 'react';

jest.mock('expo-router', () => {
  const { View } = require('react-native');
  const Tabs = (props: Record<string, unknown>) => <View {...props} />;
  Tabs.Screen = () => null;
  return { Tabs };
});

jest.mock('@/components/FloatingBubbleTabBar', () => ({
  FloatingBubbleTabBar: () => null,
}));

jest.mock('@/components/MatchOverlay', () => ({ MatchOverlay: () => null }));

import TabsLayout from '@/app/(tabs)/_layout';
import { FloatingBubbleTabBar } from '@/components/FloatingBubbleTabBar';

/** The layout's `tabBar` prop, pulled off the <Tabs> element it returns. */
function tabBarFor(focusedRoute: string): React.ReactNode {
  const tree = TabsLayout() as React.ReactElement<{ children: React.ReactNode }>;
  const tabs = React.Children.toArray(tree.props.children).find(
    (child): child is React.ReactElement<Record<string, unknown>> =>
      React.isValidElement(child) && 'tabBar' in (child.props as object),
  );
  if (!tabs) throw new Error('no <Tabs> element with a tabBar prop');

  const routes = [
    { key: 'index-1', name: 'index' },
    { key: 'swipe-1', name: 'swipe' },
    { key: 'group-1', name: 'group' },
    { key: 'saved-1', name: 'saved' },
  ];
  const index = routes.findIndex((route) => route.name === focusedRoute);
  // Without this, a typo'd route name yields index -1 → routes[-1] is undefined
  // → the layout renders the bar, and the "every other tab" case passes for the
  // wrong reason.
  if (index < 0) throw new Error(`no route named ${focusedRoute}`);
  const tabBar = tabs.props.tabBar as (props: unknown) => React.ReactNode;
  return tabBar({ state: { index, routes }, descriptors: {}, navigation: {} });
}

describe('(tabs) tab bar visibility', () => {
  it('renders no tab bar while onboarding is focused', () => {
    expect(tabBarFor('index')).toBeNull();
  });

  it('renders the tab bar on every other tab', () => {
    for (const route of ['swipe', 'group', 'saved']) {
      const bar = tabBarFor(route);
      expect(React.isValidElement(bar)).toBe(true);
      expect((bar as React.ReactElement).type).toBe(FloatingBubbleTabBar);
    }
  });
});

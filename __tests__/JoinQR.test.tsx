import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';

import { JoinQR } from '@/components/JoinQR';
import { joinUrl } from '@/lib/join-link';

// The card validates the code through lib/session, which drags in the Firestore
// SDK — ESM that jest won't transform, and a configured app it doesn't have.
// Nothing here goes near the network; stub the reach (as join-link.test.ts does).
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('@/lib/auth', () => ({ ensureAnonymousUser: jest.fn() }));

// react-native-qrcode-svg renders through react-native-svg. The pixels aren't
// what's under test here — what the card says around them is.
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: any) => <View testID="qr" {...props} />,
  };
});

function render(code: string) {
  let tree!: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<JoinQR code={code} />);
  });
  return tree;
}

function texts(tree: renderer.ReactTestRenderer): string[] {
  return tree.root
    .findAllByType(Text)
    .map((node) => React.Children.toArray(node.props.children).join(''));
}

describe('JoinQR', () => {
  // Issue #90: this card is only ever drawn inside the app, so an "open in
  // app" prompt is telling someone to open what they're already looking at.
  // The handoff lives on the web join page (public/j/index.html) instead.
  it('does not offer to open the app', () => {
    const tree = render('BCDF');
    const joined = texts(tree).join(' ').toLowerCase();
    expect(joined).not.toContain('open in app');
    expect(joined).not.toContain('moviematch://');
  });

  it('shows the join URL without its scheme', () => {
    const tree = render('BCDF');
    expect(texts(tree)).toContain(joinUrl('BCDF').replace(/^https:\/\//, ''));
  });

  it('renders nothing for a code that cannot be joined', () => {
    expect(render('ABCD').toJSON()).toBeNull();
  });
});

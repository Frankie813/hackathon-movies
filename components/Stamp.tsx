import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface StampProps {
  text: string;
  tint: string;
  bg: string;
  fg: string;
  side: 'left' | 'right';
}

export function Stamp({ text, tint, bg, fg, side }: StampProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.stamp,
          { borderColor: tint, backgroundColor: bg },
          side === 'right'
            ? { right: 24, top: 48, transform: [{ rotate: '15deg' }] }
            : { left: 24, top: 48, transform: [{ rotate: '-15deg' }] },
        ]}
      >
        <Text style={[styles.stampText, { color: fg }]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stamp: {
    position: 'absolute',
    borderWidth: 3.5,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  stampText: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 3,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 2,
  },
});

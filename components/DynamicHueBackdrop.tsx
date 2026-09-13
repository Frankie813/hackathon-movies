import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

export interface DynamicHueBackdropProps {
  width: number;
  height: number;
}

/**
 * The swipe deck's backdrop: loader.gif, scaled to fill the screen.
 *
 * Used to layer three full-screen animated GIFs at once (two independent
 * decodes of one 5MB+ GIF plus this one, each blurred), which was the actual
 * cost behind the reported lag — blur-filtering a full-screen animated image
 * is expensive, and this component was doing it three times concurrently for
 * as long as the deck stayed mounted. Down to one undecorated layer.
 */
export function DynamicHueBackdrop({ width, height }: DynamicHueBackdropProps) {
  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      <Image
        source={require('@/assets/loader.gif')}
        style={{ width, height }}
        resizeMode="cover"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
  },
});

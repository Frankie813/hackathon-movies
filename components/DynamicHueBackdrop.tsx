import React, { useEffect } from 'react';
import { Image, ImageStyle, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

export interface DynamicHueBackdropProps {
  currentThemeColor: string;
  previousThemeColor?: string;
  currentAccentColor: string;
  previousAccentColor?: string;
  width: number;
  height: number;
}

export function DynamicHueBackdrop({
  currentThemeColor,
  previousThemeColor,
  currentAccentColor,
  previousAccentColor,
  width,
  height,
}: DynamicHueBackdropProps) {
  const fromTheme = previousThemeColor || currentThemeColor || '#1a233a';
  const toTheme = currentThemeColor || '#1a233a';

  const fromAccent = previousAccentColor || currentAccentColor || '#fbbf24';
  const toAccent = currentAccentColor || '#fbbf24';

  const hueProgress = useSharedValue(0);
  const bloomPulse = useSharedValue(0.85);

  useEffect(() => {
    hueProgress.value = 0;
    hueProgress.value = withTiming(1, {
      duration: 550,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [currentThemeColor, currentAccentColor, hueProgress]);

  useEffect(() => {
    bloomPulse.value = withRepeat(
      withTiming(1.25, {
        duration: 1800,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true
    );
  }, [bloomPulse]);

  const animatedThemeOverlayStyle = useAnimatedStyle(() => {
    const bgColor = interpolateColor(
      hueProgress.value,
      [0, 1],
      [fromTheme, toTheme]
    );

    return {
      backgroundColor: bgColor,
    };
  });

  const animatedAccentOverlayStyle = useAnimatedStyle(() => {
    const tintColor = interpolateColor(
      hueProgress.value,
      [0, 1],
      [fromAccent, toAccent]
    );

    return {
      backgroundColor: tintColor,
    };
  });

  // The bloom layer is rendered at half resolution then scaled back up: it's
  // blurred past the point of showing any detail anyway (blurRadius scaled
  // down to match), so this is visually equivalent but decodes/animates 4x
  // fewer GIF pixels than mounting the same asset a second time at full res
  // — this was the one concrete, continuous cost in this component (an
  // animated GIF decoding twice, simultaneously, the whole time the deck is
  // mounted), everything else here is solid-color opacity/transform, which
  // Reanimated already drives cheaply off the JS thread.
  const BLOOM_DOWNSCALE = 2;
  const bloomWidth = width / BLOOM_DOWNSCALE;
  const bloomHeight = height / BLOOM_DOWNSCALE;

  const animatedBloomGlowStyle = useAnimatedStyle(() => {
    return {
      opacity: bloomPulse.value * 0.75,
      transform: [{ scale: BLOOM_DOWNSCALE * 1.04 * bloomPulse.value }],
    };
  });

  const imageDynamicStyle: ImageStyle = {
    width,
    height,
  };

  return (
    <View style={[styles.container, { width, height }]} pointerEvents="none">
      {/* 1. Base Animated Theme Color Floor (brightness -25%) */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.baseFloor, animatedThemeOverlayStyle]} />

      {/* 2. High-Luminance Pixel Glow / Bloom Emission Layer */}
      {/* Re-renders index.gif with high gaussian blur & scale so brightest pixels radiate light.
          Rendered at half res + half blurRadius, then scaled back up (see BLOOM_DOWNSCALE above). */}
      <Animated.View
        style={[
          styles.bloomGlowWrapper,
          { width: bloomWidth, height: bloomHeight, left: (width - bloomWidth) / 2, top: (height - bloomHeight) / 2 },
          animatedBloomGlowStyle,
        ]}
      >
        <Image
          source={require('@/assets/index.gif')}
          style={[styles.bloomGlowImage, { width: bloomWidth, height: bloomHeight }]}
          resizeMode="cover"
          blurRadius={22 / BLOOM_DOWNSCALE}
        />
      </Animated.View>

      {/* 3. Primary Full-Screen index.gif with 2% Gaussian Blur (brightness -25%) */}
      <Image
        source={require('@/assets/index.gif')}
        style={[styles.gifBackground, imageDynamicStyle]}
        resizeMode="cover"
        blurRadius={6}
      />

      {/* 4. Smooth Dynamic Hue-Shift Tint Layer (Vibrant Theme Color Blending) */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.hueTintLayer,
          animatedThemeOverlayStyle,
        ]}
      />

      {/* 5. Radiant High-Luminance Accent Flare */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.accentTintLayer,
          animatedAccentOverlayStyle,
        ]}
      />

      {/* 6. Dynamic Ambient Brightness Boost (-25%) */}
      <View style={[StyleSheet.absoluteFill, styles.brightnessBoostOverlay]} />
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
  bloomGlowWrapper: {
    position: 'absolute',
  },
  baseFloor: {
    opacity: 0.45, // -25%, then -30% more from the original +40% brightness treatment
  },
  bloomGlowImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0.85,
  },
  gifBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0.50, // -25%, then -30% more from the original +40% brightness treatment
    transform: [{ scale: 1.06 }], // Prevents edge bleed under 2% gaussian blur
  },
  hueTintLayer: {
    opacity: 0.45, // Balanced tint to let gif radiance shine through brightly
  },
  accentTintLayer: {
    opacity: 0.22,
  },
  brightnessBoostOverlay: {
    backgroundColor: 'rgba(255, 255, 255, 0.074)', // +40% brightness boost, -25% then -30% more
  },
});

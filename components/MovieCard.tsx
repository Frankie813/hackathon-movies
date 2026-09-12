import React, { useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import type { Movie } from '@/types';

interface MovieCardProps {
  movie: Movie;
  width: number;
  height: number;
  active?: boolean;
  whyLine?: string;
  onPressSpeaker?: (movie: Movie) => void;
  onToggleMute?: () => void;
  isMuted?: boolean;
}

export function MovieCard({
  movie,
  width,
  height,
  whyLine,
  onPressSpeaker,
  onToggleMute,
  isMuted = true,
}: MovieCardProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  const accentColor = movie.negativeColor || '#f59e0b';
  const themeBase = movie.themeColor || '#080d1a';

  return (
    <View style={[styles.card, { width, height }]}>
      {movie.poster && !imageError ? (
        <>
          {/* Duplicate image behind: scaled up & softened with blur filter to fill all space */}
          <Image
            source={{ uri: movie.poster }}
            style={[styles.blurredBackdrop, { width, height }]}
            resizeMode="cover"
            blurRadius={28}
          />

          {/* Primary image in front filling the window */}
          <Image
            source={{ uri: movie.poster }}
            style={[
              styles.mainImage,
              { width, height, opacity: imageLoaded ? 1 : 0.6 },
            ]}
            resizeMode="cover"
            onLoadEnd={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </>
      ) : (
        <View style={[styles.placeholderMedia, { width, height, backgroundColor: themeBase }]}>
          <Text style={styles.placeholderEmoji}>🎬</Text>
          <Text style={styles.placeholderTitle}>{movie.title}</Text>
        </View>
      )}

      {/* Top subtle vignette for header legibility */}
      <LinearGradient
        colors={['rgba(0,0,0,0.7)', 'rgba(0,0,0,0)']}
        style={[styles.topGradient, { width }]}
        pointerEvents="none"
      />

      {/* Bottom smooth gradient overlay for floating text (No boxy background) */}
      <LinearGradient
        colors={[
          'rgba(0,0,0,0)',
          'rgba(4, 7, 14, 0.4)',
          'rgba(4, 7, 14, 0.85)',
          'rgba(4, 7, 14, 0.98)',
        ]}
        locations={[0, 0.35, 0.68, 1]}
        style={[styles.bottomGradient, { width }]}
        pointerEvents="none"
      />

      {/* Floating Info Overlay (Clean with NO background box, spaced for floating buttons & tab bar) */}
      <View style={styles.floatingContent}>
        {/* Title in bold Graphique-inspired display typography + Mute control */}
        <View style={styles.titleRow}>
          <View style={styles.titleSection}>
            <Text style={styles.graphiqueTitle} numberOfLines={2}>
              {movie.title}
            </Text>
            <Text style={[styles.yearSubtitle, { color: accentColor }]}>
              {movie.year}
            </Text>
          </View>

          {onToggleMute && (
            <Pressable
              onPress={onToggleMute}
              style={styles.muteButton}
              accessibilityLabel={isMuted ? 'Unmute' : 'Mute'}
            >
              <Ionicons
                name={isMuted ? 'volume-mute' : 'volume-high'}
                size={18}
                color="#ffffff"
              />
            </Pressable>
          )}
        </View>

        {/* Gemini "Why you'll like this" slot + ElevenLabs Voice Read-Aloud Placeholder */}
        {whyLine ? (
          <View style={styles.whyWrapper}>
            <View style={styles.whyHeaderRow}>
              <Text style={styles.whyBadge}>WHY YOU'LL LIKE THIS</Text>
              <Pressable
                onPress={() => onPressSpeaker?.(movie)}
                style={styles.speakerButton}
                accessibilityLabel="Listen to Reel AI"
              >
                <Ionicons name="volume-medium" size={14} color={accentColor} />
              </Pressable>
            </View>
            <Text style={styles.whyText} numberOfLines={2}>
              "{whyLine}"
            </Text>
          </View>
        ) : null}

        {/* Tag pills: genres */}
        <View style={styles.tagRow}>
          {movie.genreNames?.slice(0, 3).map((genre) => (
            <View
              key={genre}
              style={[
                styles.genrePill,
                { borderColor: `${accentColor}55`, backgroundColor: 'rgba(0, 0, 0, 0.35)' },
              ]}
            >
              <Text style={[styles.genreText, { color: accentColor }]}>
                {genre}
              </Text>
            </View>
          ))}
        </View>

        {/* Where-to-watch badges */}
        {movie.providers && movie.providers.length > 0 && (
          <View style={styles.providersSection}>
            <Text style={styles.providersLabel}>STREAMING ON</Text>
            <View style={styles.providerRow}>
              {movie.providers.slice(0, 4).map((prov) => (
                <View key={prov} style={styles.providerBadge}>
                  <Text style={styles.providerName}>{prov}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#080d1a',
    position: 'relative',
    overflow: 'hidden',
  },
  blurredBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    transform: [{ scale: 1.15 }],
    opacity: 0.9,
  },
  mainImage: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  placeholderMedia: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  placeholderEmoji: {
    fontSize: 54,
    marginBottom: 12,
  },
  placeholderTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: 120,
    zIndex: 10,
  },
  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    height: 420,
    zIndex: 10,
  },
  floatingContent: {
    position: 'absolute',
    bottom: 160, // Clear space for action buttons (bottom: 100) & tab bar (bottom: 24)
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: 'transparent',
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  titleSection: {
    flex: 1,
    marginRight: 12,
  },
  muteButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  graphiqueTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  yearSubtitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  whyWrapper: {
    marginVertical: 4,
    backgroundColor: 'transparent',
  },
  whyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  whyBadge: {
    fontSize: 10,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.65)',
    letterSpacing: 1.5,
  },
  speakerButton: {
    padding: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  whyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f3f4f6',
    fontStyle: 'italic',
    lineHeight: 18,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 6,
  },
  genrePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  providersSection: {
    marginTop: 4,
  },
  providersLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.45)',
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  providerBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  providerName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
});

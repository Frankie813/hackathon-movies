// components/TopPicks.tsx — the end of a swipe round (issues #91, #97).
//
// Thirty cards in, the deck stops and this takes over: the algorithm's top
// three picks, drawn from titles the user has never swiped (src/lib/picks.ts).
// If none of them appeal, "Keep swiping" starts the next round — the deck
// behind these picks is already in hand, so that press costs no network.
//
// This replaces "DECK COMPLETED", which was a dead end in front of judges.
// Rendered by the Swipe tab through SwipeDeck's `renderEmpty`, so it sits
// inside the deck's viewport and nothing here is ever composited over a
// YouTube player (AGENTS.md §4) — the deck is spent, there is no player.

import { memo, useCallback } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { Movie } from '@/types';

export interface TopPicksProps {
  /** The recommendations, best first. `null` while the round is being built. */
  picks: Movie[] | null;
  /** Start the next round. The deck behind these picks is already loaded. */
  onKeepSwiping: () => void;
  /** Save a pick to the Saved tab (#87) — the "yes, this one" exit. */
  onSave: (movie: Movie) => void;
  /** ids already saved this session, so the bookmark reads as done. */
  savedIds?: ReadonlySet<number>;
  /** #20's one-liner for a pick, when one has been warmed. */
  whyFor?: (movie: Movie) => string | undefined;
  /** Accent colour, carried from the last card so the round ends in its palette. */
  accent?: string;
}

function PickRow({
  movie,
  index,
  why,
  saved,
  accent,
  onSave,
}: {
  movie: Movie;
  index: number;
  why?: string;
  saved: boolean;
  accent: string;
  onSave: () => void;
}) {
  return (
    <View style={styles.row}>
      {/* The backdrop is the poster again, blurred behind a scrim — the same
          treatment the Saved tab's rows use, so the two screens read as one
          app rather than two. */}
      {movie.poster ? (
        <Image source={{ uri: movie.poster }} style={styles.rowBackdrop} blurRadius={18} />
      ) : null}
      <View style={styles.rowScrim} pointerEvents="none" />

      <Text style={[styles.rank, { color: accent }]}>{index + 1}</Text>

      {movie.poster ? (
        <Image source={{ uri: movie.poster }} style={styles.poster} resizeMode="cover" />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          <Ionicons name="film-outline" size={20} color="#5b6172" />
        </View>
      )}

      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {movie.title}
        </Text>
        {movie.year ? <Text style={styles.rowYear}>{movie.year}</Text> : null}
        {why ? (
          <Text style={styles.rowWhy} numberOfLines={2}>
            {why}
          </Text>
        ) : movie.genreNames.length > 0 ? (
          <Text style={styles.rowWhy} numberOfLines={1}>
            {movie.genreNames.slice(0, 3).join(' · ')}
          </Text>
        ) : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={saved ? `${movie.title} saved` : `Save ${movie.title}`}
        onPress={onSave}
        hitSlop={10}
        style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
      >
        <Ionicons
          name={saved ? 'bookmark' : 'bookmark-outline'}
          size={22}
          color={saved ? accent : '#9aa1b4'}
        />
      </Pressable>
    </View>
  );
}

export const TopPicks = memo(function TopPicks({
  picks,
  onKeepSwiping,
  onSave,
  savedIds,
  whyFor,
  accent = '#fbbf24',
}: TopPicksProps) {
  const handleSave = useCallback((movie: Movie) => () => onSave(movie), [onSave]);

  // The round is still being built. This is the whole reason the picks and the
  // next deck come from one fetch: on venue Wi-Fi that call can take the best
  // part of eight seconds, and this screen is what covers it.
  if (picks === null) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={accent} />
        <Text style={styles.loadingText}>Working out your top picks…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>THAT'S 30</Text>
      <Text style={styles.title}>Your top picks</Text>
      <Text style={styles.subtitle}>
        {picks.length > 0
          ? 'Picked from everything you just swiped.'
          : 'Nothing new to suggest yet — keep swiping and we will learn more.'}
      </Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      >
        {picks.map((movie, index) => (
          <PickRow
            key={movie.id}
            movie={movie}
            index={index}
            why={whyFor?.(movie)}
            saved={savedIds?.has(movie.id) ?? false}
            accent={accent}
            onSave={handleSave(movie)}
          />
        ))}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={onKeepSwiping}
        style={({ pressed }) => [
          styles.keepButton,
          { backgroundColor: accent },
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.keepButtonLabel}>Keep swiping</Text>
      </Pressable>
      <Text style={styles.hint}>Another 30, picked from what you liked.</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  loadingText: {
    color: '#9aa1b4',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 16,
  },
  eyebrow: {
    color: '#9aa1b4',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 6,
  },
  subtitle: {
    color: '#9aa1b4',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#14161f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  rowBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Overscaled so the blur's soft edges never reach the row's border.
    transform: [{ scale: 1.3 }],
  },
  rowScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8, 10, 18, 0.72)',
  },
  rank: {
    fontSize: 20,
    fontWeight: '900',
    width: 18,
    textAlign: 'center',
  },
  poster: {
    width: 56,
    height: 84,
    borderRadius: 8,
  },
  posterFallback: {
    backgroundColor: '#14161f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    justifyContent: 'center',
  },
  rowTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  rowYear: {
    color: '#9aa1b4',
    fontSize: 12,
    marginTop: 2,
  },
  rowWhy: {
    color: '#c3c9d8',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  saveButton: {
    padding: 4,
  },
  keepButton: {
    marginTop: 20,
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: 'center',
  },
  keepButtonLabel: {
    color: '#08111f',
    fontSize: 16,
    fontWeight: '800',
  },
  hint: {
    color: '#6b7285',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  pressed: {
    opacity: 0.8,
  },
});

// app/(tabs)/saved.tsx — watch-later tab (issue #41).
//
// Step "closing beat" of the demo path: after the match reveal, a tap to this
// tab shows the pick already sitting there on both phones. Likes (#18) and
// group matches (#17) land in the same list — merged reads better than two
// sections when the demo only has a few seconds here.
//
// A like IS a save: there is no separate "save" swipe direction, so a right
// swipe on the Swipe tab is the only way something lands here as a like.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';

import { FONT_COPPERPLATE } from '@/constants/fonts';
import { UsernamePrompt } from '@/components/UsernamePrompt';
import { useAnonymousAuth } from '@/lib/auth';
import { getMovie } from '@/lib/tmdb';
import { setGenrePin } from '@/src/lib/genre-pin';
import { clearOnboardedFlag } from '@/src/lib/onboarding';
import { removeUserMatch, subscribeUserMatches } from '@/src/lib/match';
import { removeLike, resetPreferences, subscribeLikes, type LikedMovie } from '@/src/lib/persist';
import { getUsername, setUsername as saveUsername } from '@/src/lib/username';
import type { Match, Movie } from '@/types';

const MAX_PROVIDERS = 3;

/** AWP | Asiimov's signature safety-orange accent. */
const ASIIMOV_ORANGE = '#FF6B1A';

/**
 * Pool for the edit-username button's gradient — picked fresh on every mount
 * (see EditUsernameButton) so it never looks the same twice in a row.
 */
const GRADIENT_POOL = [
  '#fbbf24',
  '#f43f5e',
  '#8b5cf6',
  '#06b6d4',
  '#22c55e',
  '#ec4899',
  '#3b82f6',
  '#f97316',
  '#eab308',
  '#14b8a6',
];

function randomGradientPair(): [string, string] {
  const a = GRADIENT_POOL[Math.floor(Math.random() * GRADIENT_POOL.length)];
  let b = a;
  while (b === a) b = GRADIENT_POOL[Math.floor(Math.random() * GRADIENT_POOL.length)];
  return [a, b];
}

interface SavedEntry {
  key: string;
  kind: 'like' | 'match';
  movieId: number;
  /** Epoch ms — likedAt or matchedAt. Sort key for the merged list. */
  at: number;
  match?: Match;
}

export default function SavedScreen() {
  const router = useRouter();
  const { uid, isSigningIn, error: authError } = useAnonymousAuth();

  const [likes, setLikes] = useState<LikedMovie[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  const [username, setUsernameState] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getUsername().then((name) => {
      if (!cancelled) setUsernameState(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUsernameSave = useCallback((name: string) => {
    setEditingUsername(false);
    void saveUsername(name).then(() => setUsernameState(name));
  }, []);

  // "Reset all preferences": wipes the taste vector and liked titles, drops
  // the onboarding flag so Start shows the genre picker again, and clears the
  // genre pin (src/lib/genre-pin.ts) so a stale pin from before the reset
  // can't keep forcing the old genre once the next onboarding run picks a new
  // one. The username is deliberately left alone — it lives on its own
  // storage key, untouched by any of this.
  //
  // Navigation waits only on the local flag flips, not on resetPreferences()
  // — that one is real Firestore round-trips (a read plus a write per liked
  // title), and venue Wi-Fi is the expected case here (AGENTS.md §3), not the
  // exception. The genre picker doesn't need those to have landed to render.
  const doReset = useCallback(() => {
    if (!uid) return;
    resetPreferences(uid).catch((cause: unknown) => {
      console.warn('[saved] preferences reset did not fully land:', cause);
    });
    void Promise.all([clearOnboardedFlag(), setGenrePin(null)]).then(() => router.replace('/'));
  }, [uid, router]);

  const handleResetPress = useCallback(() => {
    Alert.alert(
      'Reset all preferences?',
      "This clears your taste profile and liked movies, and takes you back to genre selection. Your username stays the same.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Yes', style: 'destructive', onPress: () => void doReset() },
      ],
    );
  }, [doReset]);

  // Both listeners fire within a second of a write landing in Firestore's
  // local cache — that is what makes the two ACs true rather than assumed.
  useEffect(() => {
    if (!uid) return;
    return subscribeLikes(uid, setLikes);
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    return subscribeUserMatches(uid, setMatches);
  }, [uid]);

  const entries = useMemo<SavedEntry[]>(() => {
    const likeEntries: SavedEntry[] = likes.map((like) => ({
      key: `like-${like.movieId}`,
      kind: 'like',
      movieId: like.movieId,
      at: like.likedAt,
    }));
    const matchEntries: SavedEntry[] = matches.map((match) => ({
      key: `match-${match.sessionCode}-${match.tmdbId}`,
      kind: 'match',
      movieId: match.tmdbId,
      at: match.matchedAt,
      match,
    }));
    return [...likeEntries, ...matchEntries].sort((a, b) => b.at - a.at);
  }, [likes, matches]);

  // Resolved lazily and cached here for the life of the screen — getMovie()
  // already caches by id (seed or a session's own TMDB hydration), so this is
  // just tracking which ids this screen has asked for.
  const [movies, setMovies] = useState<Record<number, Movie | null>>({});
  const requested = useRef<Set<number>>(new Set());

  useEffect(() => {
    const missing = [...new Set(entries.map((entry) => entry.movieId))].filter(
      (id) => !requested.current.has(id),
    );
    missing.forEach((id) => {
      requested.current.add(id);
      void getMovie(id).then((movie) => {
        setMovies((prev) => ({ ...prev, [id]: movie }));
      });
    });
  }, [entries]);

  const handleRemove = useCallback(
    (entry: SavedEntry) => {
      if (!uid) return;
      if (entry.kind === 'like') void removeLike(uid, entry.movieId);
      else if (entry.match) void removeUserMatch(uid, entry.match.sessionCode, entry.match.tmdbId);
    },
    [uid],
  );

  const renderItem = useCallback(
    ({ item }: { item: SavedEntry }) => (
      <SavedRow entry={item} movie={movies[item.movieId]} onRemove={() => handleRemove(item)} />
    ),
    [movies, handleRemove],
  );

  if (authError) {
    return (
      <Centered>
        <Text style={styles.title}>SAVED WATCHLIST</Text>
        <Text style={styles.subtitle}>Sign-in failed: {authError.message}</Text>
      </Centered>
    );
  }

  if (isSigningIn || !uid) {
    return (
      <Centered>
        <ActivityIndicator color="#f59e0b" />
      </Centered>
    );
  }

  if (entries.length === 0) {
    return (
      <View style={styles.container}>
        <Centered>
          <View style={styles.iconCircle}>
            <Ionicons name="bookmark" size={32} color="#f59e0b" />
          </View>
          <Text style={styles.title}>SAVED WATCHLIST</Text>
          <Text style={styles.subtitle}>
            Liked movies and group matches from your sessions will appear here.
          </Text>
        </Centered>
        <ProfileActionsBar onEditUsername={() => setEditingUsername(true)} onReset={handleResetPress} />
        <UsernamePrompt
          visible={editingUsername}
          mode="edit"
          initialValue={username ?? ''}
          onConfirm={handleUsernameSave}
          onCancel={() => setEditingUsername(false)}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.key}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={<Text style={styles.header}>SAVED WATCHLIST</Text>}
        ListFooterComponent={<Text style={styles.hint}>Hold a row to remove it.</Text>}
      />
      <ProfileActionsBar onEditUsername={() => setEditingUsername(true)} onReset={handleResetPress} />
      <UsernamePrompt
        visible={editingUsername}
        mode="edit"
        initialValue={username ?? ''}
        onConfirm={handleUsernameSave}
        onCancel={() => setEditingUsername(false)}
      />
    </View>
  );
}

/**
 * Pinned to the bottom of the Saved tab: an edit-username button that wears a
 * fresh random blurred gradient every time the tab (re)mounts, and the
 * "Reset all preferences" button in AWP | Asiimov orange.
 */
function ProfileActionsBar({
  onEditUsername,
  onReset,
}: {
  onEditUsername: () => void;
  onReset: () => void;
}) {
  const gradientColors = useMemo(randomGradientPair, []);

  return (
    <View style={styles.profileActions}>
      <Pressable
        onPress={onEditUsername}
        accessibilityRole="button"
        accessibilityLabel="Edit username"
        style={({ pressed }) => [styles.editUsernameButton, pressed && styles.actionPressed]}
      >
        <LinearGradient
          colors={gradientColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <BlurView intensity={55} tint="dark" style={StyleSheet.absoluteFill} />
        <Text style={styles.editUsernameText}>Edit username</Text>
      </Pressable>

      <Pressable
        onPress={onReset}
        accessibilityRole="button"
        accessibilityLabel="Reset all preferences"
        style={({ pressed }) => [styles.resetButton, pressed && styles.actionPressed]}
      >
        <Text style={styles.resetButtonText}>Reset all preferences</Text>
      </Pressable>
    </View>
  );
}

function SavedRow({
  entry,
  movie,
  onRemove,
}: {
  entry: SavedEntry;
  movie: Movie | null | undefined;
  onRemove: () => void;
}) {
  const providers = movie?.providers.slice(0, MAX_PROVIDERS) ?? [];

  return (
    <Pressable
      onLongPress={onRemove}
      delayLongPress={400}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${movie?.title ?? 'Movie'}. Hold to remove.`}
    >
      {/* Blown-up, heavily blurred poster behind the row — the same "this
          film's colors, in the dark" treatment MatchReveal uses for the
          full-screen ambient backdrop, scaled down to a list row. Scaled up
          past the frame so the blur's soft edges never show at the row's
          border, and scrimmed underneath the content so text stays legible
          against a bright poster. */}
      {movie?.poster ? (
        <Image
          source={{ uri: movie.poster }}
          style={styles.rowBackdrop}
          resizeMode="cover"
          blurRadius={35}
        />
      ) : null}
      <View style={styles.rowScrim} pointerEvents="none" />

      {movie?.poster ? (
        <Image source={{ uri: movie.poster }} style={styles.poster} resizeMode="cover" />
      ) : (
        <View style={[styles.poster, styles.posterFallback]}>
          {movie === undefined ? (
            <ActivityIndicator size="small" color="#6a6a74" />
          ) : (
            <Ionicons name="film" size={22} color="#6a6a74" />
          )}
        </View>
      )}

      <View style={styles.rowBody}>
        <View
          style={[styles.kindBadge, entry.kind === 'match' ? styles.matchBadge : styles.likeBadge]}
        >
          <Ionicons
            name={entry.kind === 'match' ? 'sparkles' : 'heart'}
            size={11}
            color={entry.kind === 'match' ? '#fbbf24' : '#f59e0b'}
          />
          <Text
            style={[
              styles.kindBadgeText,
              entry.kind === 'match' ? styles.matchBadgeText : styles.likeBadgeText,
            ]}
          >
            {entry.kind === 'match' ? "IT'S A MATCH" : 'LIKED'}
          </Text>
        </View>

        <Text style={styles.rowTitle} numberOfLines={1}>
          {movie?.title ?? (movie === null ? `Movie #${entry.movieId}` : 'Loading…')}
        </Text>

        {entry.kind === 'match' && entry.match?.why ? (
          <Text style={styles.whyText} numberOfLines={2}>
            "{entry.match.why}"
          </Text>
        ) : null}

        {providers.length > 0 ? (
          <View style={styles.providerRow}>
            {providers.map((provider) => (
              <View key={provider} style={styles.providerBadge}>
                <Text style={styles.providerName}>{provider}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080d1a',
  },
  centered: {
    flex: 1,
    backgroundColor: '#080d1a',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 64,
    paddingBottom: 120,
    gap: 12,
  },
  header: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  hint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#14161f',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  rowPressed: {
    opacity: 0.85,
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
  poster: {
    width: 64,
    height: 96,
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
    gap: 4,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  likeBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  matchBadge: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
  },
  kindBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  likeBadgeText: {
    color: '#f59e0b',
  },
  matchBadgeText: {
    color: '#fbbf24',
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    fontFamily: FONT_COPPERPLATE,
  },
  whyText: {
    fontSize: 12,
    fontStyle: 'italic',
    color: 'rgba(255, 255, 255, 0.65)',
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  providerBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  providerName: {
    fontSize: 10,
    fontWeight: '600',
    color: '#ffffff',
  },
  profileActions: {
    paddingHorizontal: 16,
    paddingTop: 12,
    // Clears the floating tab bar (bottom: 24, height: 64 — see SwipeDeck).
    paddingBottom: 100,
    gap: 10,
  },
  editUsernameButton: {
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  editUsernameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
    textShadowColor: 'rgba(0, 0, 0, 0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  resetButton: {
    backgroundColor: ASIIMOV_ORANGE,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  actionPressed: {
    opacity: 0.85,
  },
});

import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, useRouter } from 'expo-router';
import { useAnonymousAuth } from '@/lib/auth';
import { ONBOARDING_GENRES, tasteFromGenres } from '@/src/lib/onboarding';
import { flushTaste, saveTaste } from '@/src/lib/persist';

/** 50% taller than a Saved-tab row's poster (96 — components/../app/(tabs)/saved.tsx). */
const GENRE_ROW_HEIGHT = 144;

/** Set the first time Start is shown; every later launch skips straight to Swipe. */
const ONBOARDED_KEY = 'moviematch.onboarded';

export default function OnboardingScreen() {
  const router = useRouter();

  // null = still reading the flag; true = seen before, go to Swipe.
  const [seenBefore, setSeenBefore] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((value) => {
        if (cancelled) return;
        if (value) {
          setSeenBefore(true);
        } else {
          setSeenBefore(false);
          AsyncStorage.setItem(ONBOARDED_KEY, String(Date.now())).catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setSeenBefore(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { uid } = useAnonymousAuth();
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleGenre = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Shared by Done and Skip. Skip carries no genres, so it writes nothing and
  // just moves on — identical in effect to picking none and pressing Done.
  const finish = useCallback(
    (genreIds: number[]) => {
      const proceed = () => router.replace('/swipe');
      if (uid && genreIds.length > 0) {
        const vector = tasteFromGenres(genreIds);
        // Fire-and-forget: registers the vector, then flushTaste writes it
        // immediately rather than waiting on the normal per-swipe debounce.
        void saveTaste(uid, vector);
        void flushTaste(uid).finally(proceed);
      } else {
        proceed();
      }
    },
    [uid, router],
  );

  const handleDone = useCallback(() => finish([...selected]), [finish, selected]);
  const handleSkip = useCallback(() => finish([]), [finish]);

  if (seenBefore === null) return <View style={styles.loading} />;
  if (seenBefore) return <Redirect href="/swipe" />;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>What do you like?</Text>
        <Text style={styles.subtitle}>
          Pick a few genres to get a head start — you can always keep swiping to fine-tune it.
        </Text>

        <View style={styles.genreList}>
          {ONBOARDING_GENRES.map((genre) => {
            const isSelected = selected.has(genre.id);
            return (
              <Pressable
                key={genre.id}
                onPress={() => toggleGenre(genre.id)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={genre.name}
                style={({ pressed }) => [
                  styles.genreRow,
                  isSelected && styles.genreRowSelected,
                  pressed && styles.genreRowPressed,
                ]}
              >
                {/* Blown-up, blurred poster backdrop — same treatment the Saved
                    tab's rows use, scaled up here to fill the whole block
                    instead of sitting beside a thumbnail. */}
                {genre.poster ? (
                  <Image
                    source={{ uri: genre.poster }}
                    style={styles.genreBackdrop}
                    resizeMode="cover"
                    blurRadius={1}
                  />
                ) : null}
                <View style={styles.genreScrim} pointerEvents="none" />
                {isSelected ? <View style={styles.genreSelectedTint} pointerEvents="none" /> : null}

                <View style={styles.genreContent}>
                  <Text style={styles.genreName}>{genre.name}</Text>
                  <View style={[styles.checkCircle, isSelected && styles.checkCircleSelected]}>
                    {isSelected ? (
                      <Ionicons name="checkmark" size={18} color="#080d1a" />
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={handleSkip}
          accessibilityLabel="Skip onboarding"
          style={({ pressed }) => [styles.skip, pressed && styles.skipPressed]}
        >
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <Pressable
          onPress={handleDone}
          accessibilityLabel="Done picking genres"
          style={({ pressed }) => [styles.done, pressed && styles.donePressed]}
        >
          <Text style={styles.doneText}>
            {selected.size > 0 ? `Done (${selected.size})` : 'Done'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#080d1a',
  },
  container: {
    flex: 1,
    backgroundColor: '#080d1a',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 84,
    paddingBottom: 24,
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 28,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.6)',
  },
  genreList: {
    gap: 12,
  },
  genreRow: {
    height: GENRE_ROW_HEIGHT,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#14161f',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
  },
  genreRowPressed: {
    opacity: 0.9,
  },
  genreRowSelected: {
    borderColor: '#fbbf24',
    borderWidth: 2,
  },
  genreBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Overscaled so the blur's soft edges never reach the block's border —
    // same trick app/(tabs)/saved.tsx uses for its row backdrops.
    transform: [{ scale: 1.2 }],
  },
  genreScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8, 10, 18, 0.4)',
  },
  genreSelectedTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(251, 191, 36, 0.22)',
  },
  genreContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  genreName: {
    fontSize: 24,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  checkCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleSelected: {
    backgroundColor: '#fbbf24',
    borderColor: '#fbbf24',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 12,
    // Cleared above the floating tab bar (bottom: 24, height: 64 —
    // components/FloatingBubbleTabBar.tsx), same clearance SwipeDeck's own
    // action row uses. A flex sibling below the ScrollView, not an overlay,
    // so it never floats over scrolled rows.
    paddingBottom: 98,
    gap: 12,
  },
  skip: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  skipPressed: {
    opacity: 0.6,
  },
  skipText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '700',
  },
  done: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 16,
    borderRadius: 24,
    backgroundColor: '#fbbf24',
  },
  donePressed: {
    opacity: 0.85,
  },
  doneText: {
    color: '#080d1a',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

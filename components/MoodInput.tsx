// Issue #11 — natural-language mood entry for the swipe deck.
//
// The UI half of #22: a text box plus suggestion chips, wired to
// moodToFilters() and then to a deck reload. What Gemini *understood* is shown
// back to the user (the `tone` field), because an invisible filter looks
// identical to no filter.
//
// P2. Everything here fails soft: a mood Gemini can't read, a dead network, or
// an exhausted quota all leave the current deck exactly as it was and say so.
// There is deliberately no local keyword-matching fallback — a fake filter that
// looks like it worked is worse than an honest "not now".

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { isOffline } from '@/lib/tmdb';
import { moodToFilters, type MoodFilters } from '@/src/lib/gemini';

/** The mood currently driving the deck, as the screen sees it. */
export interface AppliedMood {
  /** What the user typed, normalized. */
  text: string;
  /** Gemini's 2–4 word read on the vibe, when it gave one. */
  tone?: string;
}

export interface MoodInputProps {
  active: AppliedMood | null;
  /**
   * Reload the deck from these filters. Resolve `false` when the deck could
   * not actually be filtered (offline — getDeck() answers from seed, which is
   * a fixed catalog and ignores filters), so the sheet can say so instead of
   * claiming a mood that isn't on screen.
   */
  onApply: (filters: MoodFilters, text: string) => Promise<boolean>;
  /** Back to the unfiltered deck. Resolves once the new deck is on screen. */
  onClear: () => Promise<void>;
  accent?: string;
}

/**
 * Written to be read aloud in a demo: each one exercises a different corner of
 * #22's prompt (a negation, a tone with no genre, an audience, an intensity).
 */
const SUGGESTIONS = [
  'funny but not dumb',
  'something to cry to',
  'popcorn with the family',
  'edge of my seat',
];

/** Long enough for a sentence, short enough to stay one prompt line. */
const MAX_MOOD_LENGTH = 80;

/** How long the applied tone stays on the deck before it stops being news. */
const TOAST_MS = 4_000;

type Status = 'idle' | 'reading' | 'loading';

const BUSY_LABEL: Record<Status, string> = {
  idle: '',
  reading: 'Reading your mood…',
  loading: 'Finding films…',
};

export function MoodInput({ active, onApply, onClear, accent = '#fbbf24' }: MoodInputProps) {
  const { width } = useWindowDimensions();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // A ref, not `status`: these handlers are handed to four chips and to the
  // keyboard's submit key, and a stale `status` in one of those closures would
  // let two moods race and land out of order.
  const busy = useRef(false);
  const mounted = useRef(true);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => {
      if (mounted.current) setToast(null);
    }, TOAST_MS);
  }, []);

  const submit = useCallback(
    async (raw: string) => {
      const mood = raw.replace(/\s+/g, ' ').trim();
      if (!mood || busy.current) return;

      busy.current = true;
      setText(mood);
      setError(null);
      setStatus('reading');

      try {
        // Never throws by contract — null covers a malformed response, a 429
        // and a dead network alike, which is why the offline case is told apart
        // here rather than from an error.
        const filters = await moodToFilters(mood);
        if (!mounted.current) return;

        if (!filters) {
          setError(
            isOffline()
              ? "Moods need the network, and you're on the offline catalog right now."
              : "Couldn't read that one. Try naming a feeling, a genre, or what you don't want.",
          );
          return;
        }

        setStatus('loading');
        const landed = await onApply(filters, mood);
        if (!mounted.current) return;

        if (!landed) {
          setError(
            isOffline()
              ? "You're on the offline catalog, which can't be filtered — keeping this deck."
              : 'Nothing came back for that mood. Try something broader.',
          );
          return;
        }

        setOpen(false);
        showToast(filters.tone ? `Mood: ${filters.tone}` : `Mood: ${mood}`);
      } catch (cause: unknown) {
        console.warn('[MoodInput] mood failed:', cause);
        if (mounted.current) setError('Something went wrong reading that mood.');
      } finally {
        busy.current = false;
        if (mounted.current) setStatus('idle');
      }
    },
    [onApply, showToast],
  );

  const clear = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    setStatus('loading');
    try {
      await onClear();
      if (!mounted.current) return;
      setText('');
      setOpen(false);
      showToast('Mood cleared');
    } catch (cause: unknown) {
      console.warn('[MoodInput] clearing the mood failed:', cause);
      if (mounted.current) setError('Could not reload the default deck.');
    } finally {
      busy.current = false;
      if (mounted.current) setStatus('idle');
    }
  }, [onClear, showToast]);

  const openSheet = useCallback(() => {
    setError(null);
    setText(active?.text ?? '');
    setOpen(true);
  }, [active]);

  // Dismissing mid-request would leave the deck swapping behind a closed sheet
  // with no way to see the result, so the close paths are inert while busy.
  const closeSheet = useCallback(() => {
    if (!busy.current) setOpen(false);
  }, []);

  const isBusy = status !== 'idle';

  return (
    <>
      {/* Docked bottom-left: clear of SwipeDeck's centered Like/Pass buttons,
          and well below the card's video window (which starts 104pt down) —
          chrome must never be drawn over the YouTube player (AGENTS.md §4). */}
      <View style={styles.dock} pointerEvents="box-none">
        {toast ? (
          <View
            style={[styles.toast, { borderColor: `${accent}66`, maxWidth: width - 40 }]}
            pointerEvents="none"
          >
            <Text style={[styles.toastText, { color: accent }]} numberOfLines={2}>
              {toast}
            </Text>
          </View>
        ) : null}

        <Pressable
          onPress={openSheet}
          testID="mood-open"
          accessibilityRole="button"
          accessibilityLabel={active ? `Mood: ${active.tone ?? active.text}` : 'Set a mood'}
          style={({ pressed }) => [
            styles.dockButton,
            active ? { borderColor: accent, shadowColor: accent } : null,
            { transform: [{ scale: pressed ? 0.9 : 1 }] },
          ]}
        >
          <Text style={styles.dockIcon}>✨</Text>
          {active ? <View style={[styles.dockDot, { backgroundColor: accent }]} /> : null}
        </Pressable>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={closeSheet}
        statusBarTranslucent
      >
        <View style={styles.backdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeSheet}
            accessibilityLabel="Dismiss mood"
          />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={styles.sheet}>
              <View style={styles.grabber} />
              <Text style={styles.heading}>What are you in the mood for?</Text>

              <TextInput
                testID="mood-text"
                style={[styles.input, { borderColor: `${accent}55` }]}
                value={text}
                onChangeText={setText}
                editable={!isBusy}
                maxLength={MAX_MOOD_LENGTH}
                placeholder="funny but not dumb"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={(event) => void submit(event.nativeEvent.text)}
              />

              <View style={styles.chips}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    testID={`mood-chip-${suggestion}`}
                    accessibilityRole="button"
                    disabled={isBusy}
                    onPress={() => void submit(suggestion)}
                    style={({ pressed }) => [
                      styles.chip,
                      isBusy ? styles.chipDisabled : null,
                      pressed ? { borderColor: accent } : null,
                    ]}
                  >
                    <Text style={styles.chipText}>{suggestion}</Text>
                  </Pressable>
                ))}
              </View>

              {active ? (
                <Text style={styles.applied} testID="mood-applied">
                  Now showing:{' '}
                  <Text style={[styles.appliedValue, { color: accent }]}>
                    {active.tone ?? active.text}
                  </Text>
                </Text>
              ) : null}

              {error ? (
                <Text style={styles.error} testID="mood-error">
                  {error}
                </Text>
              ) : null}

              {isBusy ? (
                <View style={styles.busyRow} testID="mood-busy">
                  <ActivityIndicator color={accent} />
                  <Text style={styles.busyText}>{BUSY_LABEL[status]}</Text>
                </View>
              ) : (
                <View style={styles.actions}>
                  {active ? (
                    <Pressable
                      testID="mood-clear"
                      accessibilityRole="button"
                      onPress={() => void clear()}
                      style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.7 : 1 }]}
                    >
                      <Text style={styles.secondaryText}>Clear mood</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    testID="mood-apply"
                    accessibilityRole="button"
                    disabled={!text.trim()}
                    onPress={() => void submit(text)}
                    style={({ pressed }) => [
                      styles.primary,
                      {
                        backgroundColor: accent,
                        opacity: text.trim() ? (pressed ? 0.85 : 1) : 0.4,
                      },
                    ]}
                  >
                    <Text style={styles.primaryText}>Set mood</Text>
                  </Pressable>
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 20,
    // Same band as SwipeDeck's action buttons (bottom: 98), which are centered.
    bottom: 98,
    alignItems: 'flex-start',
    gap: 10,
    zIndex: 45,
  },
  dockButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 20, 30, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
  },
  dockIcon: {
    fontSize: 20,
  },
  dockDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toast: {
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toastText: {
    fontSize: 12,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 14,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 4,
  },
  heading: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '800',
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#ffffff',
    fontSize: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  chipDisabled: {
    opacity: 0.45,
  },
  chipText: {
    color: 'rgba(255, 255, 255, 0.82)',
    fontSize: 13,
  },
  applied: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 13,
  },
  appliedValue: {
    fontWeight: '800',
  },
  error: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  busyText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
  },
  secondary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 14,
    fontWeight: '600',
  },
  primary: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 20,
  },
  primaryText: {
    color: '#080d1a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

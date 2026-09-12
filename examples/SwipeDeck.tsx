// SwipeDeck.tsx — the main screen (expo-router: app/(tabs)/swipe.tsx or similar)
//
// Install (Expo):
//   npx expo install react-native-reanimated react-native-gesture-handler
//   npm i rn-swiper-list
// Wrap your root layout in <GestureHandlerRootView style={{ flex: 1 }}>.

import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Swiper, type SwiperCardRefType } from 'rn-swiper-list';
import { TrailerCard } from './TrailerCard';
import type { Movie } from './types';
import seed from './seed.sample.json';

// Stand-ins for Person C's modules. Replace with the real imports.
const rankDeck = (movies: Movie[]): Movie[] => movies;          // taste-vector re-rank
const recordSwipe = (_movie: Movie, _delta: 1 | -1) => {};      // updates taste vector + Firestore
const whyFor = (_movie: Movie): string | undefined => undefined; // cached Gemini line

export default function SwipeDeck() {
  const { width } = useWindowDimensions();
  const cardW = width - 32;

  const [deck] = useState<Movie[]>(() => rankDeck(seed as Movie[]));
  const [index, setIndex] = useState(0);
  const swiper = useRef<SwiperCardRefType>(null);

  const onSwipe = useCallback(
    (cardIndex: number, delta: 1 | -1) => recordSwipe(deck[cardIndex], delta),
    [deck],
  );

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.brand}>MovieMatch</Text>
        <Text style={styles.count}>{Math.min(index + 1, deck.length)} of {deck.length}</Text>
      </View>

      <View style={styles.deckArea}>
        <Swiper
          ref={swiper}
          data={deck}
          cardStyle={{ width: cardW }}
          renderCard={(movie, i) => (
            // Only the top card plays; the next card is mounted but paused so its
            // iframe is warm when it becomes active. Keep the stack shallow — each
            // card is a WebView.
            <TrailerCard movie={movie} width={cardW} active={i === index} whyLine={whyFor(movie)} />
          )}
          onIndexChange={setIndex}
          onSwipeRight={(i) => onSwipe(i, 1)}
          onSwipeLeft={(i) => onSwipe(i, -1)}
          onSwipedAll={() => {/* refill from TMDB or show "deck done" */}}
          disableTopSwipe
          // Stamps are absolutely positioned near the bottom of the card so they land
          // in the chrome region, not over the video.
          OverlayLabelRight={() => <Stamp text="Like" tint="#639922" bg="#eaf3de" fg="#3b6d11" side="right" />}
          OverlayLabelLeft={() => <Stamp text="Nope" tint="#e24b4a" bg="#fcebeb" fg="#a32d2d" side="left" />}
        />
      </View>

      <View style={styles.actions}>
        <RoundButton label="✕" color="#a32d2d" border="#f09595" onPress={() => swiper.current?.swipeLeft()} a11y="Nope" />
        <RoundButton label="♥" color="#3b6d11" border="#97c459" onPress={() => swiper.current?.swipeRight()} a11y="Like" />
      </View>
      <Text style={styles.hint}>Swipe right to like</Text>
    </View>
  );
}

function Stamp({ text, tint, bg, fg, side }: { text: string; tint: string; bg: string; fg: string; side: 'left' | 'right' }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View
        style={[
          styles.stamp,
          { borderColor: tint, backgroundColor: bg },
          side === 'right' ? { right: 16, transform: [{ rotate: '-12deg' }] } : { left: 16, transform: [{ rotate: '12deg' }] },
        ]}
      >
        <Text style={[styles.stampText, { color: fg }]}>{text}</Text>
      </View>
    </View>
  );
}

function RoundButton({ label, color, border, onPress, a11y }: { label: string; color: string; border: string; onPress: () => void; a11y: string }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={a11y} style={[styles.round, { borderColor: border }]}>
      <Text style={{ fontSize: 22, color }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f5f0', paddingTop: 56 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 12 },
  brand: { fontSize: 14, fontWeight: '600' },
  count: { fontSize: 13, color: '#6b6a64' },
  deckArea: { flex: 1, alignItems: 'center' },
  stamp: {
    position: 'absolute', bottom: 18,
    borderWidth: 2, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 3,
  },
  stampText: { fontSize: 18, fontWeight: '600' },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 32, marginTop: 8 },
  round: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
  },
  hint: { textAlign: 'center', fontSize: 12, color: '#8a8982', marginTop: 8, marginBottom: 24 },
});

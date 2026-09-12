// TrailerCard.tsx
// One card in the deck. The YouTube iframe sits on top; every piece of our own
// UI (title, mute, providers, Gemini "why" line) sits BELOW it, never over it.
//
// Install (Expo):
//   npx expo install react-native-webview
//   npm i react-native-youtube-iframe

import React, { useCallback, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import YoutubePlayer, {
  PLAYER_STATES,
  type YoutubeIframeRef,
} from 'react-native-youtube-iframe';
import type { Movie } from './types';

type Props = {
  movie: Movie;
  width: number;      // card width; player height is derived (16:9)
  active: boolean;    // only the top card plays
  whyLine?: string;   // Gemini "why you'd like this", already fetched + cached
};

export function TrailerCard({ movie, width, active, whyLine }: Props) {
  const playerH = Math.round((width * 9) / 16);
  const playerRef = useRef<YoutubeIframeRef>(null);

  const [muted, setMuted] = useState(true);       // autoplay only works muted
  const [ready, setReady] = useState(false);      // poster shows until the iframe is up
  const [failed, setFailed] = useState(!movie.video); // no key, or embed/region error

  const start = movie.video?.start ?? 0;

  // Loop the chosen segment instead of letting YouTube show the end screen.
  const onStateChange = useCallback(
    (state: string) => {
      if (state === PLAYER_STATES.ENDED) playerRef.current?.seekTo(start, true);
    },
    [start],
  );

  // embed_not_allowed / video_not_found / html5_error → poster, and the deck
  // can auto-advance if you want (see SwipeDeck onCardFailed).
  const onError = useCallback(() => setFailed(true), []);

  return (
    <View style={[styles.card, { width }]}>
      {/* ---- player region: nothing of ours is drawn on top of this ---- */}
      <View style={{ height: playerH, backgroundColor: '#000' }}>
        {!failed && movie.video && (
          // pointerEvents="none": taps/drags go to the swipe gesture, not the WebView,
          // and we don't need a transparent overlay to capture them.
          <View pointerEvents="none">
            <YoutubePlayer
              ref={playerRef}
              height={playerH}
              width={width}
              videoId={movie.video.key}
              play={active}
              mute={muted}
              forceAndroidAutoplay
              initialPlayerParams={{
                start,
                end: movie.video.end,
                controls: false,
                rel: false,
                loop: false,
              }}
              onReady={() => setReady(true)}
              onChangeState={onStateChange}
              onError={onError}
              webViewProps={{ androidLayerType: 'hardware' }}
            />
          </View>
        )}
        {(failed || !ready) && (
          <Image
            source={{ uri: movie.poster }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
      </View>

      {/* ---- chrome: everything below the player ---- */}
      <View style={styles.chrome}>
        <View style={styles.row}>
          <Text style={styles.title} numberOfLines={1}>
            {movie.title} <Text style={styles.year}>{movie.year}</Text>
          </Text>
          {!failed && (
            <Pressable
              onPress={() => setMuted((m) => !m)}
              hitSlop={12}
              accessibilityLabel={muted ? 'Unmute' : 'Mute'}
              style={styles.muteBtn}
            >
              <Text style={styles.muteIcon}>{muted ? '🔇' : '🔊'}</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.genres}>{movie.genreNames.join(', ')}</Text>

        {movie.providers.length > 0 && (
          <View style={styles.pill}>
            <Text style={styles.pillText}>On {movie.providers.join(', ')}</Text>
          </View>
        )}

        {whyLine ? <Text style={styles.why}>{whyLine}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d8d6cf',
  },
  chrome: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 17, fontWeight: '600', flex: 1, marginRight: 8 },
  year: { fontSize: 13, fontWeight: '400', color: '#6b6a64' },
  muteBtn: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#b4b2a9',
    alignItems: 'center', justifyContent: 'center',
  },
  muteIcon: { fontSize: 14 },
  genres: { fontSize: 12, color: '#6b6a64', marginTop: 2 },
  pill: {
    alignSelf: 'flex-start', marginTop: 8,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
    backgroundColor: '#e6f1fb',
  },
  pillText: { fontSize: 11, color: '#0c447c' },
  why: {
    marginTop: 10, fontSize: 13, lineHeight: 19,
    borderLeftWidth: 2, borderLeftColor: '#85b7eb', paddingLeft: 10,
  },
});

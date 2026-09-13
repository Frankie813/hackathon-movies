// TrailerVideoPlayer.web.tsx — web override (Metro picks this over
// TrailerVideoPlayer.tsx for web bundles).
//
// A raw YouTube embed URL autoplays muted on its own (no JS bridge needed for
// that), and loop=1&playlist=<self> handles looping without an "ended" event.
// Trade-off, both honest limitations of a bridge-less iframe: no error channel
// (a dead video key just shows a blank iframe rather than falling back to the
// poster), and looping restarts the full clip rather than reseeking to `start`.
//
// Same layout contract as native: the component covers the card, dims it, and
// shows the zoomed 16:9 frame clipped to the window at `frameTop`. There is no
// live backdrop video on web; the card's blurred still shows through instead.

import React, { forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
// react-native-web exports this DOM escape hatch, but @types/react-native
// (which this file's imports resolve against even though it only bundles for
// web) doesn't know about it.
// @ts-expect-error -- untyped react-native-web-only export, web bundle only
import { unstable_createElement } from 'react-native';

export const FRAME_ZOOM = 1.34;
export const LANDSCAPE_ASPECT = 16 / 9;
export const SHORT_ASPECT = 9 / 16;

export interface TrailerVideoPlayerRef {
  seekTo: (seconds: number) => void;
}

export interface TrailerVideoPlayerProps {
  videoId: string;
  start: number;
  end?: number;
  /** Card size; the player covers all of it. */
  width: number;
  height: number;
  /** Window for the sharp foreground video: full card width, from `frameTop`, `frameHeight` tall. */
  frameTop: number;
  frameHeight: number;
  /** Video aspect ratio (width / height). 16:9 for trailers, 9:16 for Shorts. */
  aspect?: number;
  /** Zoom applied to the frame inside the window. Defaults to FRAME_ZOOM. */
  zoom?: number;
  muted: boolean;
  play: boolean;
  onReady: () => void;
  onEnded: () => void;
  onError: (error: string) => void;
}

export const TrailerVideoPlayer = forwardRef<TrailerVideoPlayerRef, TrailerVideoPlayerProps>(
  function TrailerVideoPlayer(
    {
      videoId,
      start,
      end,
      width,
      height,
      frameTop,
      frameHeight,
      aspect = LANDSCAPE_ASPECT,
      zoom = FRAME_ZOOM,
      play,
      onReady,
    },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      // No postMessage channel to a plain cross-origin iframe on web.
      seekTo: () => {},
    }));

    // No warm-up on web: a hidden card just sits cued, and promotion changes
    // the src (a reload) to start playback.
    const params: Record<string, string> = {
      autoplay: play ? '1' : '0',
      mute: '1',
      loop: '1',
      playlist: videoId,
      controls: '0',
      rel: '0',
      modestbranding: '1',
      iv_load_policy: '3',
      playsinline: '1',
      start: String(start),
    };
    if (end) params.end = String(end);
    const query = new URLSearchParams(params).toString();

    let frameH = frameHeight * zoom;
    let frameW = frameH * aspect;
    if (frameW < width) {
      frameW = width;
      frameH = width / aspect;
    }

    return (
      <View style={{ width, height }}>
        <View style={[StyleSheet.absoluteFill, styles.dim]} />
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: frameTop,
            width,
            height: frameHeight,
            overflow: 'hidden',
            backgroundColor: '#000',
          }}
        >
          {unstable_createElement('iframe', {
            src: `https://www.youtube.com/embed/${videoId}?${query}`,
            allow: 'autoplay; encrypted-media',
            title: videoId,
            onLoad: onReady,
            style: {
              border: 0,
              position: 'absolute',
              left: (width - frameW) / 2,
              top: (frameHeight - frameH) / 2,
              width: frameW,
              height: frameH,
              pointerEvents: 'none',
            },
          })}
        </View>
      </View>
    );
  }
);

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(4, 7, 14, 0.45)',
  },
});

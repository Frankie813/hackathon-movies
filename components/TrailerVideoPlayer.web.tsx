// TrailerVideoPlayer.web.tsx — web override (Metro picks this over
// TrailerVideoPlayer.tsx for web bundles).
//
// A raw YouTube embed URL autoplays muted on its own (no JS bridge needed for
// that), and loop=1&playlist=<self> handles looping without an "ended" event.
// Trade-off, both honest limitations of a bridge-less iframe: no error channel
// (a dead video key just shows a blank iframe rather than falling back to the
// poster), and looping restarts the full clip rather than reseeking to `start`.
//
// The iframe fills exactly the `width` × `height` box the parent gives it;
// MovieCard sizes that box to a 16:9 letterbox and positions it.

import React, { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
// react-native-web exports this DOM escape hatch, but @types/react-native
// (which this file's imports resolve against even though it only bundles for
// web) doesn't know about it.
// @ts-expect-error -- untyped react-native-web-only export, web bundle only
import { unstable_createElement } from 'react-native';

export interface TrailerVideoPlayerRef {
  seekTo: (seconds: number) => void;
}

export interface TrailerVideoPlayerProps {
  videoId: string;
  start: number;
  end?: number;
  /** Box the player fills; the parent decides aspect ratio and placement. */
  width: number;
  height: number;
  muted: boolean;
  play: boolean;
  onReady: () => void;
  onEnded: () => void;
  onError: (error: string) => void;
}

export const TrailerVideoPlayer = forwardRef<TrailerVideoPlayerRef, TrailerVideoPlayerProps>(
  function TrailerVideoPlayer({ videoId, start, end, width, height, onReady }, ref) {
    useImperativeHandle(ref, () => ({
      // No postMessage channel to a plain cross-origin iframe on web.
      seekTo: () => {},
    }));

    const params: Record<string, string> = {
      autoplay: '1',
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

    return (
      <View style={{ width, height, overflow: 'hidden', backgroundColor: '#000' }}>
        {unstable_createElement('iframe', {
          src: `https://www.youtube.com/embed/${videoId}?${query}`,
          allow: 'autoplay; encrypted-media',
          title: videoId,
          onLoad: onReady,
          style: {
            border: 0,
            width,
            height,
            pointerEvents: 'none',
          },
        })}
      </View>
    );
  }
);

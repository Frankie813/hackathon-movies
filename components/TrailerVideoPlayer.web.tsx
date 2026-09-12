// TrailerVideoPlayer.web.tsx — web override (Metro picks this over
// TrailerVideoPlayer.tsx for web bundles).
//
// react-native-youtube-iframe's web path goes through react-native-web-webview,
// which renders the player as a plain cross-origin <iframe> with no
// window.ReactNativeWebView bridge — onReady/onChangeState/postMessage never
// fire there (see https://github.com/LonelyCpp/react-native-youtube-iframe/issues/340).
// Bypassing that wrapper entirely: a raw YouTube embed URL autoplays muted on
// its own (no JS bridge needed for that), and loop=1&playlist=<self> handles
// looping without an "ended" event. Trade-off, both honest limitations of a
// bridge-less iframe: no error channel (a dead video key just shows a blank
// iframe rather than falling back to the poster), and looping restarts the
// full clip rather than reseeking to `start`.

import React, { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';
// react-native-web exports this DOM escape hatch, but @types/react-native
// (which this file's imports resolve against even though it only bundles for
// web) doesn't know about it.
// @ts-expect-error -- untyped react-native-web-only export, web bundle only
import { unstable_createElement } from 'react-native';
import { coverSize } from '@/lib/coverSize';

export interface TrailerVideoPlayerRef {
  seekTo: (seconds: number) => void;
}

export interface TrailerVideoPlayerProps {
  videoId: string;
  start: number;
  end?: number;
  containerWidth: number;
  containerHeight: number;
  muted: boolean;
  play: boolean;
  onReady: () => void;
  onEnded: () => void;
  onError: (error: string) => void;
}

export const TrailerVideoPlayer = forwardRef<TrailerVideoPlayerRef, TrailerVideoPlayerProps>(
  function TrailerVideoPlayer(
    { videoId, start, end, containerWidth, containerHeight, onReady },
    ref
  ) {
    useImperativeHandle(ref, () => ({
      // No postMessage channel to a plain cross-origin iframe on web.
      seekTo: () => {},
    }));

    const cover = coverSize(containerWidth, containerHeight);
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
      <View style={{ width: containerWidth, height: containerHeight, overflow: 'hidden' }}>
        {unstable_createElement('iframe', {
          src: `https://www.youtube.com/embed/${videoId}?${query}`,
          allow: 'autoplay; encrypted-media',
          title: videoId,
          onLoad: onReady,
          style: {
            border: 0,
            position: 'absolute',
            left: cover.offsetX,
            top: cover.offsetY,
            width: cover.width,
            height: cover.height,
            pointerEvents: 'none',
          },
        })}
      </View>
    );
  }
);

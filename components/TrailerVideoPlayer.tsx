// TrailerVideoPlayer.tsx — native (iOS/Android) player.
//
// Oversizes the 16:9 YoutubePlayer WebView and centers it so the clip covers
// a portrait card edge-to-edge (content may bleed past the visible frame —
// the parent card clips with overflow:hidden), instead of letterboxing.

import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { View } from 'react-native';
import YoutubePlayer, {
  PLAYER_STATES,
  type YoutubeIframeRef,
} from 'react-native-youtube-iframe';
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
    { videoId, start, end, containerWidth, containerHeight, muted, play, onReady, onEnded, onError },
    ref
  ) {
    const playerRef = useRef<YoutubeIframeRef>(null);

    useImperativeHandle(ref, () => ({
      seekTo: (seconds: number) => playerRef.current?.seekTo(seconds, true),
    }));

    const cover = coverSize(containerWidth, containerHeight);

    return (
      <View
        style={{
          position: 'absolute',
          left: cover.offsetX,
          top: cover.offsetY,
          width: cover.width,
          height: cover.height,
        }}
      >
        <YoutubePlayer
          ref={playerRef}
          height={cover.height}
          width={cover.width}
          videoId={videoId}
          play={play}
          mute={muted}
          forceAndroidAutoplay
          initialPlayerParams={{
            start,
            end,
            controls: false,
            rel: false,
            modestbranding: true,
            loop: false,
            iv_load_policy: 3,
            preventFullScreen: true,
          }}
          onReady={onReady}
          onChangeState={(state: string) => {
            if (state === PLAYER_STATES.ENDED || state === 'ended') onEnded();
          }}
          onError={onError}
          webViewProps={{
            androidLayerType: 'hardware',
            allowsInlineMediaPlayback: true,
            mediaPlaybackRequiresUserAction: false,
            // react-native-webview's postMessage() on Android dispatches to
            // `document`, but the injected YouTube player page listens on
            // `window` (see PlayerScripts.js) — two different EventTargets,
            // so play/pause/mute commands are silently dropped on Android
            // without this bridge. iOS dispatches to `window` directly and
            // doesn't need it, but re-dispatching there too is harmless.
            // https://github.com/react-native-webview/react-native-webview/issues/2980
            injectedJavaScriptBeforeContentLoaded: `
              document.addEventListener('message', function (e) {
                window.dispatchEvent(new MessageEvent('message', { data: e.data }));
              });
              true;
            `,
          }}
        />
      </View>
    );
  }
);

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
          // NOTE: tried useLocalHTML here to skip the per-card fetch of
          // https://lonelycpp.github.io/.../iframe_v2.html, but every video
          // started erroring out on-device (not just genuinely restricted
          // ones) — inline HTML with no real HTTP(S) origin most likely
          // breaks YouTube's IFrame API origin validation. Reverted to the
          // library's default remote-hosted shell, which is the configuration
          // actually confirmed working end-to-end on a real device.
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
            // so play/pause/mute commands are silently dropped on Android.
            // https://github.com/react-native-webview/react-native-webview/issues/2980
            //
            // Rather than relay document->window and hope the page's own
            // window listener (and its `player` closure) picks it up, this
            // calls player.playVideo()/pauseVideo()/mute()/unMute() directly:
            // `player` is a top-level `var` in the page's own <script> (see
            // MAIN_SCRIPT in PlayerScripts.js), which makes it a property of
            // the shared global object — reachable from here too, since
            // injectedJavaScript runs in the same document/JS realm. One
            // fewer hop than a relay, and doesn't depend on the page's own
            // listener behaving as expected.
            //
            // injectedJavaScript (onPageFinished), not
            // injectedJavaScriptBeforeContentLoaded (onPageStarted): the
            // latter is a known-flaky timing hook on Android that can fire
            // before the new document exists. This only needs to be
            // registered before the first real command, which can't arrive
            // until well after page load (gated on the player reaching
            // "ready" first).
            injectedJavaScript: `
              document.addEventListener('message', function (e) {
                try {
                  var msg = JSON.parse(e.data);
                  if (typeof player === 'undefined' || !player) return;
                  switch (msg.eventName) {
                    case 'playVideo': player.playVideo(); break;
                    case 'pauseVideo': player.pauseVideo(); break;
                    case 'muteVideo': player.mute(); break;
                    case 'unMuteVideo': player.unMute(); break;
                  }
                } catch (err) {}
              });
              true;
            `,
          }}
        />
      </View>
    );
  }
);

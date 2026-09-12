// TrailerVideoPlayer.tsx — native (iOS/Android) player.
//
// Drives the YouTube IFrame API directly through react-native-webview rather
// than through react-native-youtube-iframe. That library's `play` / `mute`
// props are dead in 2.4.x: by default it loads a remote shell page
// (lonelycpp.github.io/…/iframe_v2.html, last deployed 2024-06-15) that still
// switches on raw-string messages, while the JS wrapper has sent a JSON
// envelope since 2.4.0 — upstream #376 / #386 / #393, all open. Separately,
// react-native-webview's postMessage() dispatches to `document` on Android
// while that page listens on `window`. Rather than shim two broken hops, this
// shell:
//   - asks YouTube itself to start muted playback via player vars
//     (autoplay=1&mute=1), so autoplay needs no RN→page command at all;
//   - sends later commands (unmute, pause, seek) with injectJavaScript, which
//     is reliable on both platforms;
//   - receives ready/state/error via window.ReactNativeWebView.postMessage.
//
// The 16:9 WebView is oversized and centered so the clip covers a portrait
// card edge-to-edge; the parent card clips the overflow.

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { coverSize } from '@/lib/coverSize';

/**
 * YouTube rejects API-created embeds that arrive without an HTTP Referer
 * (player error 153). Inline HTML has no origin of its own, so the shell is
 * loaded with this as its base URL. Any https origin works; this is the
 * project's public domain (#33).
 */
export const EMBED_REFERRER = 'https://movienight.tech/';

/** How long YouTube gets to report ready before the card falls back to the poster. */
export const READY_TIMEOUT_MS = 20_000;

/** YouTube IFrame API onError codes → the strings MovieCard logs and handles. */
const PLAYER_ERRORS: Record<number, string> = {
  2: 'invalid_parameter',
  5: 'html5_error',
  100: 'video_not_found',
  101: 'embed_not_allowed',
  150: 'embed_not_allowed',
  153: 'missing_referrer',
};

/** YT.PlayerState.ENDED */
const STATE_ENDED = 0;

interface ShellMessage {
  eventType?: string;
  data?: unknown;
}

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

interface ShellOptions {
  videoId: string;
  start: number;
  end?: number;
  autoplay: boolean;
  muted: boolean;
}

/** Serialize for embedding inside a <script>; `<` is escaped so `</script>` can't break out. */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildShellHtml({ videoId, start, end, autoplay, muted }: ShellOptions): string {
  const playerVars: Record<string, number> = {
    autoplay: autoplay ? 1 : 0,
    mute: muted ? 1 : 0,
    start,
    playsinline: 1,
    controls: 0,
    rel: 0,
    fs: 0,
    disablekb: 1,
    iv_load_policy: 3,
    modestbranding: 1,
  };
  if (end) playerVars.end = end;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
  #player, iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<div id="player"></div>
<script>
  var player = null;
  function send(eventType, data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ eventType: eventType, data: data }));
    }
  }
  function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      videoId: ${jsLiteral(videoId)},
      playerVars: ${jsLiteral(playerVars)},
      events: {
        onReady: function () { send('ready'); },
        onStateChange: function (e) { send('state', e.data); },
        onError: function (e) { send('error', e.data); }
      }
    });
  }
  var tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = function () { send('error', 'network'); };
  document.head.appendChild(tag);
</script>
</body>
</html>`;
}

export const TrailerVideoPlayer = forwardRef<TrailerVideoPlayerRef, TrailerVideoPlayerProps>(
  function TrailerVideoPlayer(
    { videoId, start, end, containerWidth, containerHeight, muted, play, onReady, onEnded, onError },
    ref
  ) {
    const webViewRef = useRef<WebView>(null);
    const readyRef = useRef(false);

    // Latest props/callbacks, readable from handlers without re-binding them.
    const latest = useRef({ play, muted, onReady, onEnded, onError });
    latest.current = { play, muted, onReady, onEnded, onError };

    // Player vars are baked into the page at load; later prop changes are
    // applied with injectJavaScript, so the source must not change on them.
    const initial = useRef({ play, muted });
    const source = useMemo(
      () => ({
        html: buildShellHtml({
          videoId,
          start,
          end,
          autoplay: initial.current.play,
          muted: initial.current.muted,
        }),
        baseUrl: EMBED_REFERRER,
      }),
      [videoId, start, end]
    );

    const inject = useCallback((js: string) => {
      webViewRef.current?.injectJavaScript(`try { ${js} } catch (e) {} true;`);
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        seekTo: (seconds: number) => {
          if (!readyRef.current) return;
          // seekTo() from the ended state plays; playVideo() covers the paused case.
          inject(`player.seekTo(${Number(seconds) || 0}, true); player.playVideo();`);
        },
      }),
      [inject]
    );

    // Mute/unmute and play/pause after load. Skipped until the player is
    // ready; the ready handler applies whatever the props are at that moment.
    useEffect(() => {
      if (readyRef.current) inject(muted ? 'player.mute();' : 'player.unMute();');
    }, [muted, inject]);

    useEffect(() => {
      if (readyRef.current) inject(play ? 'player.playVideo();' : 'player.pauseVideo();');
    }, [play, inject]);

    // Offline venue Wi-Fi: if YouTube never reports ready, fall back to the poster.
    useEffect(() => {
      readyRef.current = false;
      const timer = setTimeout(() => {
        if (!readyRef.current) latest.current.onError('timeout');
      }, READY_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }, [source]);

    const handleMessage = useCallback(
      (event: WebViewMessageEvent) => {
        let message: ShellMessage;
        try {
          message = JSON.parse(event.nativeEvent.data) as ShellMessage;
        } catch {
          return;
        }
        switch (message.eventType) {
          case 'ready': {
            readyRef.current = true;
            const { play: shouldPlay, muted: isMuted } = latest.current;
            // Reconcile with the props as they are now, in case they changed
            // during load. Only issue commands that change something: a
            // redundant playVideo() on an already-autoplaying video makes
            // YouTube flash its play/pause bezel. Mute before play so a mobile
            // UA never sees an unmuted autoplay. 1 = PLAYING, 3 = BUFFERING.
            inject(
              `${isMuted ? 'if (!player.isMuted()) player.mute();' : 'if (player.isMuted()) player.unMute();'} ` +
                `var s = player.getPlayerState(); ` +
                (shouldPlay
                  ? 'if (s !== 1 && s !== 3) player.playVideo();'
                  : 'if (s === 1 || s === 3) player.pauseVideo();')
            );
            latest.current.onReady();
            break;
          }
          case 'state':
            if (message.data === STATE_ENDED) latest.current.onEnded();
            break;
          case 'error': {
            const code = message.data;
            latest.current.onError(
              typeof code === 'number'
                ? (PLAYER_ERRORS[code] ?? `youtube_error_${code}`)
                : String(code)
            );
            break;
          }
        }
      },
      [inject]
    );

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
        <WebView
          ref={webViewRef}
          testID="trailer-webview"
          source={source}
          originWhitelist={['*']}
          style={{ width: cover.width, height: cover.height, backgroundColor: '#000' }}
          onMessage={handleMessage}
          onError={() => latest.current.onError('webview_error')}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo={false}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          setSupportMultipleWindows={false}
          androidLayerType="hardware"
          webviewDebuggingEnabled={__DEV__}
        />
      </View>
    );
  }
);

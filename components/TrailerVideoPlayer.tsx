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
// Layout: the WebView covers the whole card with a transparent page, so the
// card's blurred still shows through. A dim layer sits over that, and the
// sharp video is clipped to a full-width window starting at `frameTop`,
// `frameHeight` tall, with the 16:9 frame zoomed by FRAME_ZOOM so cinematic
// letterbox bands land outside the window and the sides overspill. Nothing of
// the card's own chrome is drawn over this window.
//
// Warm-up: a card mounted with `play={false}` (the deck's hidden next card)
// plays muted for WARM_MS so YouTube's adaptive streaming steps up from its
// low starting rung, then parks paused at `start`. When `play` flips to true
// it resumes from that buffer at the ramped quality — no ramp on screen.
// (A tried-and-dead alternative: YouTube's `vq` hint and setPlaybackQuality()
// no longer influence the starting quality at all.)

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

/**
 * YouTube rejects API-created embeds that arrive without an HTTP Referer
 * (player error 153). Inline HTML has no origin of its own, so the shell is
 * loaded with this as its base URL. Any https origin works; this is the
 * project's public domain (#33).
 */
export const EMBED_REFERRER = 'https://movienight.tech/';

/** How long YouTube gets to report ready before the card falls back to the poster. */
export const READY_TIMEOUT_MS = 20_000;

/** How long a hidden card plays muted to let YouTube ramp quality before parking. */
export const WARM_MS = 4_000;

/**
 * Zoom applied to the 16:9 frame inside its window. A 2.39:1 film fills 74.4%
 * of a 16:9 trailer frame; 1.34x pushes those black bands out of the window.
 * A natively 16:9 trailer loses ~13% top and bottom instead.
 */
export const FRAME_ZOOM = 1.34;

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
  /** Card size; the player covers all of it. */
  width: number;
  height: number;
  /** Window for the sharp video: full card width, from `frameTop`, `frameHeight` tall. */
  frameTop: number;
  frameHeight: number;
  /** Video aspect ratio (width / height). 16:9 for trailers, 9:16 for Shorts. */
  aspect?: number;
  /** Zoom applied to the frame inside the window. Defaults to FRAME_ZOOM. */
  zoom?: number;
  muted: boolean;
  /** false = mounted hidden as the deck's next card: warm the buffer, stay muted, don't show. */
  play: boolean;
  onReady: () => void;
  onEnded: () => void;
  onError: (error: string) => void;
}

export interface ShellLayout {
  cardWidth: number;
  cardHeight: number;
  frameTop: number;
  frameHeight: number;
  aspect: number;
  zoom: number;
}

export const LANDSCAPE_ASPECT = 16 / 9;
export const SHORT_ASPECT = 9 / 16;

interface ShellOptions {
  videoId: string;
  start: number;
  end?: number;
  autoplay: boolean;
  muted: boolean;
  layout: ShellLayout;
}

/** Serialize for embedding inside a <script>; `<` is escaped so `</script>` can't break out. */
function jsLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function buildShellHtml({ videoId, start, end, autoplay, muted, layout }: ShellOptions): string {
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
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  #dim { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: rgba(4, 7, 14, 0.45); }
  #fg { position: absolute; left: 0; overflow: hidden; background: #000; }
  #fgplayer { position: absolute; }
  #fgplayer iframe { position: absolute; left: 0; top: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
<div id="dim"></div>
<div id="fg"><div id="fgplayer"><div id="player"></div></div></div>
<script>
  var player = null;
  var layout = ${jsLiteral(layout)};

  function applyLayout() {
    var W = layout.cardWidth;
    var fg = document.getElementById('fg');
    fg.style.top = layout.frameTop + 'px';
    fg.style.width = W + 'px';
    fg.style.height = layout.frameHeight + 'px';
    // Zoomed frame centered in the window; never narrower than the window.
    var frameH = layout.frameHeight * layout.zoom;
    var frameW = frameH * layout.aspect;
    if (frameW < W) { frameW = W; frameH = W / layout.aspect; }
    var fgp = document.getElementById('fgplayer');
    fgp.style.left = ((W - frameW) / 2) + 'px';
    fgp.style.top = ((layout.frameHeight - frameH) / 2) + 'px';
    fgp.style.width = frameW + 'px';
    fgp.style.height = frameH + 'px';
  }
  function setLayout(next) {
    layout.frameTop = next.frameTop;
    layout.frameHeight = next.frameHeight;
    applyLayout();
  }
  applyLayout();

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
        onReady: function () {
          // YouTube auto-enables captions on muted playback; there is no
          // player var to stop that. Unloading the captions module is the
          // long-standing workaround.
          try { player.unloadModule('captions'); } catch (e) {}
          send('ready');
        },
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
      muted,
      play,
      onReady,
      onEnded,
      onError,
    },
    ref
  ) {
    const webViewRef = useRef<WebView>(null);
    const readyRef = useRef(false);
    const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Latest props/callbacks, readable from handlers without re-binding them.
    const latest = useRef({ play, muted, start, frameTop, frameHeight, onReady, onEnded, onError });
    latest.current = { play, muted, start, frameTop, frameHeight, onReady, onEnded, onError };

    // Player vars and the window geometry are baked into the page whenever it
    // is (re)built — on mount, or when the video itself changes (a Short
    // falling back to the landscape clip). Play/mute/layout changes in
    // between are applied with injectJavaScript, so they are deliberately
    // not dependencies: the memo reads their current values via `latest`.
    // A hidden card loads cued (no autoplay) and is warmed from the ready
    // handler instead.
    const source = useMemo(
      () => ({
        html: buildShellHtml({
          videoId,
          start,
          end,
          autoplay: latest.current.play,
          muted: latest.current.muted,
          layout: {
            cardWidth: width,
            cardHeight: height,
            frameTop: latest.current.frameTop,
            frameHeight: latest.current.frameHeight,
            aspect,
            zoom,
          },
        }),
        baseUrl: EMBED_REFERRER,
      }),
      [videoId, start, end, width, height, aspect, zoom]
    );

    const inject = useCallback((js: string) => {
      webViewRef.current?.injectJavaScript(`try { ${js} } catch (e) {} true;`);
    }, []);

    const clearWarm = useCallback(() => {
      if (warmTimer.current) {
        clearTimeout(warmTimer.current);
        warmTimer.current = null;
      }
    }, []);
    useEffect(() => clearWarm, [clearWarm]);

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

    // Mute/unmute after load, only while showing: a hidden card stays muted
    // no matter what the card's mute state is, and gets the real state when
    // it is promoted.
    useEffect(() => {
      if (readyRef.current && play) inject(muted ? 'player.mute();' : 'player.unMute();');
    }, [muted, play, inject]);

    // Promotion (play: false → true): apply the real mute state, then resume
    // from `start`, which the warm-up left buffered. Demotion just pauses.
    useEffect(() => {
      if (!readyRef.current) return;
      if (play) {
        clearWarm();
        inject(
          `${muted ? 'player.mute();' : 'player.unMute();'} ` +
            `player.seekTo(${latest.current.start}, true); player.playVideo();`
        );
      } else {
        inject('player.pauseVideo();');
      }
      // `muted` is applied by the effect above when it changes on its own.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [play, clearWarm, inject]);

    // Window geometry can change after mount (the card measures its title
    // block). Harmless before the page has loaded; re-sent on ready.
    useEffect(() => {
      inject(`setLayout(${JSON.stringify({ frameTop, frameHeight })});`);
    }, [frameTop, frameHeight, inject]);

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
            const { play: shouldPlay, muted: isMuted, start: from, frameTop: top, frameHeight: h } =
              latest.current;
            inject(`setLayout(${JSON.stringify({ frameTop: top, frameHeight: h })});`);
            if (shouldPlay) {
              // Reconcile with the props as they are now, in case they changed
              // during load. Only issue commands that change something: a
              // redundant playVideo() on an already-autoplaying video makes
              // YouTube flash its play/pause bezel. Mute before play so a
              // mobile UA never sees an unmuted autoplay. 1 = PLAYING, 3 = BUFFERING.
              inject(
                `${isMuted ? 'if (!player.isMuted()) player.mute();' : 'if (player.isMuted()) player.unMute();'} ` +
                  `var s = player.getPlayerState(); if (s !== 1 && s !== 3) player.playVideo();`
              );
            } else {
              // Hidden: warm the buffer muted, then park at `start`.
              inject('player.mute(); player.playVideo();');
              clearWarm();
              warmTimer.current = setTimeout(() => {
                warmTimer.current = null;
                if (!latest.current.play) inject(`player.pauseVideo(); player.seekTo(${from}, true);`);
              }, WARM_MS);
            }
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
      [inject, clearWarm]
    );

    return (
      <WebView
        ref={webViewRef}
        testID="trailer-webview"
        source={source}
        originWhitelist={['*']}
        // Transparent so the card's blurred still shows through outside the window.
        style={{ width, height, backgroundColor: 'transparent' }}
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
    );
  }
);

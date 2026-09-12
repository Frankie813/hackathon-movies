import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { MovieCard } from '@/components/MovieCard';
import type { Movie } from '@/types';

// Mock react-native-webview: the native TrailerVideoPlayer drives the YouTube
// IFrame API through it directly. The mock exposes the props it was given and
// records injectJavaScript calls so the RN -> page command path is observable.
const mockInjectJavaScript = jest.fn();
jest.mock('react-native-webview', () => {
  const React = require('react');
  const { View } = require('react-native');

  const MockWebView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      injectJavaScript: mockInjectJavaScript,
    }));
    return <View {...props} />;
  });

  return { __esModule: true, WebView: MockWebView, default: MockWebView };
});

// Mock expo vector icons
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name, ...props }: any) => <Text testID={`icon-${name}`}>{name}</Text>,
  };
});

// Mock expo-linear-gradient (not relevant to these assertions)
jest.mock('expo-linear-gradient', () => {
  const { View } = require('react-native');
  return { LinearGradient: (props: any) => <View {...props} /> };
});

const mockMovieWithVideo: Movie = {
  id: 27205,
  title: 'Inception',
  year: 2010,
  genreIds: [28, 878, 12],
  genreNames: ['Action', 'Sci-Fi', 'Adventure'],
  keywords: ['dream', 'heist', 'subconscious'],
  poster: 'https://image.tmdb.org/t/p/w780/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg',
  providers: ['Netflix', 'Max'],
  video: {
    key: 'YoHD9XEInc0',
    start: 5,
    end: 25,
    source: 'trailer',
  },
  themeColor: '#081426',
  negativeColor: '#f59e0b',
};

const mockMovieWithoutVideo: Movie = {
  id: 99999,
  title: 'Movie Without Video',
  year: 2024,
  genreIds: [18],
  genreNames: ['Drama'],
  keywords: ['indie'],
  poster: 'https://image.tmdb.org/t/p/w780/fake.jpg',
  providers: ['Hulu'],
  video: null,
};

/** Simulate a message posted by the player shell page. */
function postShellMessage(webview: renderer.ReactTestInstance, eventType: string, data?: unknown) {
  act(() => {
    webview.props.onMessage({ nativeEvent: { data: JSON.stringify({ eventType, data }) } });
  });
}

let tree: renderer.ReactTestRenderer | null = null;

function render(element: React.ReactElement) {
  act(() => {
    tree = renderer.create(element);
  });
  return tree!.root;
}

afterEach(() => {
  // Unmount so the player's ready-timeout timer is cleared between tests.
  act(() => {
    tree?.unmount();
  });
  tree = null;
  mockInjectJavaScript.mockClear();
});

describe('MovieCard trailer playback (Issue #7)', () => {
  it('renders title, year, genres, and providers', () => {
    const root = render(
      <MovieCard
        movie={mockMovieWithVideo}
        width={360}
        height={720}
        active
        whyLine="Mind-bending visual masterpiece for fans of sci-fi heists."
      />
    );

    expect(root.findByProps({ children: 'Inception' })).toBeTruthy();
    expect(root.findByProps({ children: 2010 })).toBeTruthy();
    expect(root.findByProps({ children: 'Action' })).toBeTruthy();
    expect(root.findByProps({ children: 'Netflix' })).toBeTruthy();
  });

  it('loads the YouTube shell with the clip segment, muted autoplay, and a referrer', () => {
    const root = render(
      <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
    );

    const webview = root.findByProps({ testID: 'trailer-webview' });
    const { html, baseUrl } = webview.props.source;
    expect(html).toContain('"YoHD9XEInc0"');
    expect(html).toContain('"autoplay":1');
    expect(html).toContain('"mute":1');
    expect(html).toContain('"start":5');
    expect(html).toContain('"end":25');
    expect(html).toContain('"playsinline":1');
    // YouTube rejects API embeds with no HTTP Referer (error 153).
    expect(baseUrl).toMatch(/^https:\/\//);
    expect(webview.props.mediaPlaybackRequiresUserAction).toBe(false);
    expect(webview.props.allowsInlineMediaPlayback).toBe(true);
  });

  it('letterboxes the full 16:9 frame at card width, clear of the header and title block', () => {
    // 852pt tall like an iPhone 16: 312pt of room between header and chrome.
    const root = render(
      <MovieCard movie={mockMovieWithVideo} width={360} height={852} active />
    );

    const frame = root.findByProps({ testID: 'trailer-frame' });
    expect(frame.props.style.width).toBe(360);
    expect(frame.props.style.height).toBe(203); // 360 / (16/9), rounded
    expect(frame.props.style.top).toBeGreaterThanOrEqual(120);
    expect(frame.props.style.top + 203).toBeLessThanOrEqual(852 - 420);
    // Centered in that room: 120 + (312 - 203) / 2, rounded.
    expect(frame.props.style.top).toBe(175);

    const webview = root.findByProps({ testID: 'trailer-webview' });
    expect(webview.props.style.width).toBe(360);
    expect(webview.props.style.height).toBe(203);
  });

  it('shows the trailer thumbnail as a blurred backdrop and falls back on load error', () => {
    const root = render(
      <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
    );

    let backdrop = root.findByProps({ testID: 'trailer-backdrop' });
    expect(backdrop.props.source.uri).toBe('https://i.ytimg.com/vi/YoHD9XEInc0/maxresdefault.jpg');
    expect(backdrop.props.blurRadius).toBeGreaterThan(0);

    act(() => {
      backdrop.props.onError();
    });
    backdrop = root.findByProps({ testID: 'trailer-backdrop' });
    expect(backdrop.props.source.uri).toBe('https://i.ytimg.com/vi/YoHD9XEInc0/mqdefault.jpg');

    act(() => {
      backdrop.props.onError();
    });
    backdrop = root.findByProps({ testID: 'trailer-backdrop' });
    expect(backdrop.props.source.uri).toBe(mockMovieWithVideo.poster);
  });

  it('falls back to the poster without rendering a player when the movie has no video', () => {
    const root = render(
      <MovieCard movie={mockMovieWithoutVideo} width={360} height={720} active />
    );

    expect(() => root.findByProps({ testID: 'trailer-webview' })).toThrow();
    expect(root.findByProps({ children: 'Movie Without Video' })).toBeTruthy();
  });

  it('re-applies muted playback once the player reports ready', () => {
    const root = render(
      <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
    );

    const webview = root.findByProps({ testID: 'trailer-webview' });
    expect(mockInjectJavaScript).not.toHaveBeenCalled();

    postShellMessage(webview, 'ready');

    expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
    const js = mockInjectJavaScript.mock.calls[0][0] as string;
    expect(js).toContain('player.mute();');
    expect(js).toContain('player.playVideo();');
    // Mute is applied before play so a mobile UA never sees an unmuted autoplay.
    expect(js.indexOf('player.mute();')).toBeLessThan(js.indexOf('player.playVideo();'));
  });

  it('toggles mute/unmute state when the tap-to-unmute button is pressed', () => {
    const root = render(
      <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
    );

    const webview = root.findByProps({ testID: 'trailer-webview' });
    postShellMessage(webview, 'ready');
    mockInjectJavaScript.mockClear();

    const muteBtn = root.findByProps({ accessibilityLabel: 'Unmute trailer' });
    expect(muteBtn).toBeTruthy();

    act(() => {
      muteBtn.props.onPress();
    });

    expect(root.findByProps({ accessibilityLabel: 'Mute trailer' })).toBeTruthy();
    expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
    expect(mockInjectJavaScript.mock.calls[0][0]).toContain('player.unMute();');
  });

  it('falls back to the poster when YouTube reports an error, and reports the failure', () => {
    const onCardFailedMock = jest.fn();
    const root = render(
      <MovieCard
        movie={mockMovieWithVideo}
        width={360}
        height={720}
        active
        onCardFailed={onCardFailedMock}
      />
    );

    const webview = root.findByProps({ testID: 'trailer-webview' });
    // 101 = embed_not_allowed
    postShellMessage(webview, 'error', 101);

    expect(onCardFailedMock).toHaveBeenCalledWith(mockMovieWithVideo);
    expect(() => root.findByProps({ testID: 'trailer-webview' })).toThrow();
  });

  it('falls back to the poster when the IFrame API script cannot load (offline)', () => {
    const onCardFailedMock = jest.fn();
    const root = render(
      <MovieCard
        movie={mockMovieWithVideo}
        width={360}
        height={720}
        active
        onCardFailed={onCardFailedMock}
      />
    );

    const webview = root.findByProps({ testID: 'trailer-webview' });
    postShellMessage(webview, 'error', 'network');

    expect(onCardFailedMock).toHaveBeenCalledWith(mockMovieWithVideo);
    expect(() => root.findByProps({ testID: 'trailer-webview' })).toThrow();
  });

  it('loops the clip by seeking back to the start when the video ends', () => {
    const root = render(
      <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
    );

    const webview = root.findByProps({ testID: 'trailer-webview' });
    postShellMessage(webview, 'ready');
    mockInjectJavaScript.mockClear();

    // 0 = YT.PlayerState.ENDED
    postShellMessage(webview, 'state', 0);

    expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
    expect(mockInjectJavaScript.mock.calls[0][0]).toContain('player.seekTo(5, true);');
  });
});

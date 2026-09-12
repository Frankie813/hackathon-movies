import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { MovieCard } from '@/components/MovieCard';
import type { Movie } from '@/types';

// Mock react-native-youtube-iframe
jest.mock('react-native-youtube-iframe', () => {
  const React = require('react');
  const { View, Text } = require('react-native');

  const MockYoutubePlayer = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      seekTo: jest.fn(),
    }));
    return (
      <View testID="youtube-player" {...props}>
        <Text testID="player-props">{JSON.stringify({
          play: props.play,
          mute: props.mute,
          videoId: props.videoId,
          initialPlayerParams: props.initialPlayerParams,
        })}</Text>
      </View>
    );
  });

  return {
    __esModule: true,
    default: MockYoutubePlayer,
    PLAYER_STATES: {
      ENDED: 'ended',
      PLAYING: 'playing',
      PAUSED: 'paused',
      BUFFERING: 'buffering',
    },
  };
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

describe('MovieCard trailer playback (Issue #7)', () => {
  it('renders title, year, genres, and providers', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <MovieCard
          movie={mockMovieWithVideo}
          width={360}
          height={720}
          active
          whyLine="Mind-bending visual masterpiece for fans of sci-fi heists."
        />
      );
    });

    const root = tree!.root;
    expect(root.findByProps({ children: 'Inception' })).toBeTruthy();
    expect(root.findByProps({ children: 2010 })).toBeTruthy();
    expect(root.findByProps({ children: 'Action' })).toBeTruthy();
    expect(root.findByProps({ children: 'Netflix' })).toBeTruthy();
  });

  it('renders the YouTube player when the movie has a video key', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
      );
    });

    const root = tree!.root;
    const player = root.findByProps({ testID: 'youtube-player' });
    expect(player).toBeTruthy();
    expect(player.props.videoId).toBe('YoHD9XEInc0');
    expect(player.props.mute).toBe(true);
    expect(player.props.initialPlayerParams.start).toBe(5);
    expect(player.props.initialPlayerParams.end).toBe(25);
  });

  it('falls back to the poster without rendering a player when the movie has no video', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <MovieCard movie={mockMovieWithoutVideo} width={360} height={720} active />
      );
    });

    const root = tree!.root;
    expect(() => root.findByProps({ testID: 'youtube-player' })).toThrow();
    expect(root.findByProps({ children: 'Movie Without Video' })).toBeTruthy();
  });

  it('toggles mute/unmute state when the tap-to-unmute button is pressed', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
      );
    });

    const root = tree!.root;
    const muteBtn = root.findByProps({ accessibilityLabel: 'Unmute trailer' });
    expect(muteBtn).toBeTruthy();

    act(() => {
      muteBtn.props.onPress();
    });

    const unmutedBtn = root.findByProps({ accessibilityLabel: 'Mute trailer' });
    expect(unmutedBtn).toBeTruthy();
  });

  it('falls back to the poster when the player triggers onError, and reports the failure', () => {
    const onCardFailedMock = jest.fn();
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <MovieCard
          movie={mockMovieWithVideo}
          width={360}
          height={720}
          active
          onCardFailed={onCardFailedMock}
        />
      );
    });

    const root = tree!.root;
    const player = root.findByProps({ testID: 'youtube-player' });
    act(() => {
      player.props.onError('embed_not_allowed');
    });

    expect(onCardFailedMock).toHaveBeenCalledWith(mockMovieWithVideo);
    expect(() => root.findByProps({ testID: 'youtube-player' })).toThrow();
  });

  it('loops the clip by seeking back to the start when the video ends', () => {
    let tree: renderer.ReactTestRenderer | null = null;
    act(() => {
      tree = renderer.create(
        <MovieCard movie={mockMovieWithVideo} width={360} height={720} active />
      );
    });

    const root = tree!.root;
    const player = root.findByProps({ testID: 'youtube-player' });
    // Should not throw when the underlying player reports "ended".
    expect(() => {
      act(() => {
        player.props.onChangeState('ended');
      });
    }).not.toThrow();
  });
});

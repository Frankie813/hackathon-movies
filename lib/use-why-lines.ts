// lib/use-why-lines.ts — the UI half of #20.
//
// lib/gemini.ts owns the request, the cache and the quota; this owns the React
// state that gets Reel's line onto the card. It lives here rather than in the
// screen so it can be tested without mounting the whole Swipe tab.

import { useCallback, useEffect, useState } from 'react';

import { cachedWhyLine, subscribeWhyLines, whyLine } from '@/lib/gemini';
import type { Movie } from '@/types';

export interface WhyLines {
  /** Synchronous read for SwipeDeck's `whyFor`. Safe on the render path. */
  whyFor: (movie: Movie) => string | undefined;
  /**
   * Whether the card should hold the why slot open (#8). Flips on after the
   * first line of the session arrives, which is the only evidence we have that
   * Gemini is actually reachable: offline, or once the 15 RPM cooldown opens,
   * no line ever lands and the cards would otherwise all carry a permanent gap
   * above the genres. The cost is one growth on the very first card.
   */
  expectWhyLine: boolean;
  /**
   * Warm the lines for the cards about to be shown. Fire-and-forget: whyLine()
   * never rejects, dedupes concurrent calls and serves repeats from cache, so
   * calling this on every card change costs one request per *new* movie.
   */
  prefetch: (movies: Movie[], likes: Movie[]) => void;
}

export function useWhyLines(): WhyLines {
  const [lines, setLines] = useState<Record<number, string>>({});

  // Lines arrive long after the card mounted. Without this the line would only
  // ever show up on a *later* card — the one on screen stays blank (#20).
  useEffect(
    () =>
      subscribeWhyLines((tmdbId, line) => {
        setLines((prev) => (prev[tmdbId] === line ? prev : { ...prev, [tmdbId]: line }));
      }),
    [],
  );

  const whyFor = useCallback(
    (movie: Movie): string | undefined => lines[movie.id] ?? cachedWhyLine(movie.id),
    [lines],
  );

  const prefetch = useCallback((movies: Movie[], likes: Movie[]) => {
    for (const movie of movies) void whyLine(movie, likes);
  }, []);

  return { whyFor, expectWhyLine: Object.keys(lines).length > 0, prefetch };
}

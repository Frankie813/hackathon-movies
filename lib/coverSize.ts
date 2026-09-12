// coverSize.ts — pixel math for the CSS `object-fit: cover` equivalent.
//
// Neither react-native-youtube-iframe's WebView box nor a raw <iframe> embed
// supports object-fit, so a fixed-aspect-ratio video has to be oversized and
// centered by hand to fill a container of a different aspect ratio (a
// portrait phone screen vs. a 16:9 clip) without letterboxing.

export interface CoverSize {
  width: number;
  height: number;
  /** Offset (<= 0) to center the oversized box within the container. */
  offsetX: number;
  offsetY: number;
}

export function coverSize(
  containerWidth: number,
  containerHeight: number,
  aspectRatio: number = 16 / 9
): CoverSize {
  const height = Math.max(containerHeight, containerWidth / aspectRatio);
  const width = height * aspectRatio;

  return {
    width,
    height,
    offsetX: (containerWidth - width) / 2,
    offsetY: (containerHeight - height) / 2,
  };
}

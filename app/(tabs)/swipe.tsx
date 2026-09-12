import { ScreenStub } from '@/components/ScreenStub';
import { seedMovies, seedMoviesWithVideo } from '@/lib/seed';

export default function SwipeScreen() {
  // Reading the bundled catalog here is the offline proof for #4: with Wi-Fi
  // off these counts still render. The real deck lands in #6/#7/#8.
  return (
    <ScreenStub
      title="Swipe"
      subtitle={
        `Trailer card stack goes here (#6, #7, #8).\n\n` +
        `${seedMovies.length} movies bundled offline · ` +
        `${seedMoviesWithVideo.length} with a validated clip.`
      }
    />
  );
}

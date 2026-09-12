import { ScreenStub } from '@/components/ScreenStub';
import { useAnonymousAuth } from '@/lib/auth';

export default function OnboardingScreen() {
  // Surfacing the uid here makes #2's acceptance criteria checkable on a
  // physical device without tailing the Metro logs. Replaced by the real
  // onboarding deck in #9.
  const { uid, isSigningIn, error } = useAnonymousAuth();

  const authLine = error
    ? `Sign-in failed: ${error.message}`
    : isSigningIn
      ? 'Signing in…'
      : `Signed in anonymously as ${uid}`;

  return (
    <ScreenStub
      title="Onboarding"
      subtitle={`Polarizing deck goes here — seeds the taste vector (#9).\n\n${authLine}`}
    />
  );
}

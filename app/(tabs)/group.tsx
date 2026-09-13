// app/(tabs)/group.tsx — create or join a group session (issue #16).
//
// Step 3 of the demo path: a second phone joins by code and both devices see
// the member list update live. The active code lives in lib/active-session so
// the Swipe tab records every swipe into it (#16) and the match overlay in the
// tabs layout can watch the group (#17, #10).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { JoinQR } from '@/components/JoinQR';
import { UsernamePrompt } from '@/components/UsernamePrompt';
import { setActiveCode, useActiveCode } from '@/lib/active-session';
import { useAnonymousAuth } from '@/lib/auth';
import { onJoinRequested, parseJoinLink, takeParkedJoin } from '@/lib/join-link';
import {
  createSession,
  isValidCode,
  joinSession,
  memberLabel,
  normalizeCode,
  SessionNotFoundError,
  subscribe,
} from '@/lib/session';
import { getUsername, setUsername as saveUsername } from '@/src/lib/username';
import type { Member } from '@/types';

export default function GroupScreen() {
  const { uid, isSigningIn, error: authError } = useAnonymousAuth();

  // Restored from the last run before anything renders a "start a group"
  // button the user would have to press again (#16 step 5).
  const { code, ready } = useActiveCode();
  const [input, setInput] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The display name this device sends when it (re)joins a session, so the
  // member list shows something better than "Guest XXXX" from the first join
  // onward. Set in the onboarding gate (app/(tabs)/index.tsx); editable here.
  const [username, setUsernameState] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getUsername().then((name) => {
      if (!cancelled) setUsernameState(name);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUsernameSave = useCallback(
    (name: string) => {
      setEditingUsername(false);
      void saveUsername(name).then(() => {
        setUsernameState(name);
        // joinSession() on an existing member only updates `name` — it never
        // touches likes/dislikes (see lib/session.ts), so this is safe to fire
        // even mid-session.
        if (code) {
          joinSession(code, name).catch((cause: unknown) => {
            console.warn('[group] could not update the name on the session:', cause);
          });
        }
      });
    },
    [code],
  );

  // enterSession() needs the code as it is *now*, not as it was when the work
  // it is awaiting started — see the setMembers guard below.
  const codeRef = useRef<string | null>(null);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  // Rejoin on restore: the member doc already exists, so this only refreshes
  // presence — likes and dislikes are left alone (see joinSession).
  useEffect(() => {
    if (!code || !uid) return;
    joinSession(code, username ?? undefined).catch((cause: unknown) => {
      if (cause instanceof SessionNotFoundError) {
        setActiveCode(null);
        setError('That session is gone. Start a new one.');
        return;
      }
      console.warn('[group] rejoin failed:', cause);
    });
    // Also fires once the async username read resolves, so a restored session
    // picks up the name even though it wasn't known yet on the first rejoin.
  }, [code, uid, username]);

  useEffect(() => {
    if (!code || !uid) return;
    // Unsubscribing here is what stops listeners piling up across rehearsal
    // runs — every Fast Refresh would otherwise leave one behind.
    return subscribe(code, setMembers);
  }, [code, uid]);

  const enterSession = useCallback(async (work: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      const joined = await work();
      // Only blank the list when the session actually changes. Landing on the
      // session you are already in — a deep link for the code you restored
      // into (#19) — leaves the listener attached, and a rejoin writes
      // nothing, so there is no next snapshot to refill a list cleared here.
      if (codeRef.current !== joined) setMembers([]);
      setActiveCode(joined);
      setInput('');
    } catch (cause: unknown) {
      setError(
        cause instanceof SessionNotFoundError
          ? cause.message
          : `Could not reach the session. ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // A code that arrived over a deep link (#19). It wins over the restored
  // code: someone who just scanned a QR means to be in *that* group, and
  // enterSession() overwrites the persisted code either way. The parked read
  // covers a cold start, where app/join/[code].tsx ran before this mounted.
  useEffect(() => {
    const handle = (incoming: string) => {
      void enterSession(async () => {
        await joinSession(incoming, username ?? undefined);
        return incoming;
      });
    };
    const parked = takeParkedJoin();
    if (parked) handle(parked);
    return onJoinRequested(handle);
  }, [enterSession, username]);

  const onCreate = useCallback(
    () => void enterSession(() => createSession(username ?? undefined)),
    [enterSession, username],
  );

  const onJoin = useCallback(() => {
    // The keyboard's "go" key reaches this too, where the Join button's
    // disabled state does not — without the guard a half-typed code would go
    // to the network, and a second submit could race the first join.
    if (busy || !isValidCode(input)) return;
    const normalized = normalizeCode(input);
    void enterSession(async () => {
      await joinSession(normalized, username ?? undefined);
      return normalized;
    });
  }, [busy, enterSession, input, username]);

  const onLeave = useCallback(() => {
    // Local only — the member doc stays, so coming back is a rejoin and the
    // swipes are still there. #17 needs the history even if a phone drops.
    setActiveCode(null);
    setMembers([]);
    setError(null);
  }, []);

  if (authError) {
    return (
      <Centered>
        <Text style={styles.title}>Group</Text>
        <Text style={styles.error}>Sign-in failed: {authError.message}</Text>
      </Centered>
    );
  }

  if (isSigningIn || !uid || !ready) {
    return (
      <Centered>
        <ActivityIndicator color="#e50914" />
        <Text style={styles.subtitle}>Signing in…</Text>
      </Centered>
    );
  }

  if (!code) {
    return (
      <Centered>
        <Text style={styles.title}>Watch together</Text>
        <Text style={styles.subtitle}>
          Start a group and read the code out, or type the one your friend has.
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onCreate}
          style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
        >
          <Text style={styles.primaryLabel}>{busy ? 'Starting…' : 'Start a group'}</Text>
        </Pressable>

        <Text style={styles.divider}>or join one</Text>

        <TextInput
          accessibilityLabel="Join code"
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!busy}
          // No maxLength: it would truncate a pasted link to four characters
          // before onChangeText ever saw it. Every path below already caps the
          // value at CODE_LENGTH.
          // A guest who got the link over text rather than across a table
          // pastes the whole URL in here. Take the code out of it rather than
          // letting normalizeCode() shred it into four arbitrary consonants.
          onChangeText={(text) => setInput(parseJoinLink(text) ?? normalizeCode(text))}
          onSubmitEditing={onJoin}
          placeholder="CODE"
          placeholderTextColor="#4a4a52"
          returnKeyType="go"
          style={styles.codeInput}
          value={input}
        />

        <Pressable
          accessibilityRole="button"
          disabled={busy || !isValidCode(input)}
          onPress={onJoin}
          style={({ pressed }) => [
            styles.secondary,
            !isValidCode(input) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.secondaryLabel}>Join</Text>
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Centered>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.sessionContainer}>
      <Text style={styles.subtitle}>Join code</Text>
      {/* Big enough to read across a table from a judge's second phone. */}
      <Text accessibilityLabel={`Join code ${code.split('').join(' ')}`} style={styles.code}>
        {code}
      </Text>

      {/* The zero-friction join: a guest points a camera at this instead of
          typing. The code above still works if the scan doesn't (#19). */}
      <JoinQR code={code} />

      <Text style={styles.memberHeading}>
        {members.length} {members.length === 1 ? 'person' : 'people'} in this group
      </Text>

      <View style={styles.memberList}>
        {members.length === 0 ? (
          <Text style={styles.subtitle}>Waiting for the list to sync…</Text>
        ) : (
          members.map((member) => (
            <View key={member.uid} style={styles.memberRow}>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName}>
                  {memberLabel(member)}
                  {member.uid === uid ? ' (you)' : ''}
                </Text>
                {member.uid === uid ? (
                  <Pressable
                    onPress={() => setEditingUsername(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Edit your name"
                    hitSlop={8}
                    style={({ pressed }) => [styles.editNameButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="pencil" size={13} color="#9a9aa2" />
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.memberCounts}>
                ♥ {member.likes.length} · ✕ {member.dislikes.length}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* The swipes themselves happen on the Swipe tab; every one lands on
          this member's document, and the counts above follow within ~1s. */}
      <Text style={styles.hint}>
        Head to Swipe. Every like and pass counts for the group. When you agree,
        it&apos;s a match.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        onPress={onLeave}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Text style={styles.secondaryLabel}>Leave</Text>
      </Pressable>

      <UsernamePrompt
        visible={editingUsername}
        mode="edit"
        initialValue={username ?? ''}
        onConfirm={handleUsernameSave}
        onCancel={() => setEditingUsername(false)}
      />
    </ScrollView>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.container}>{children}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101014',
    padding: 24,
    gap: 12,
  },
  sessionContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101014',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 15,
    color: '#9a9aa2',
    textAlign: 'center',
  },
  code: {
    fontSize: 72,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 12,
    // letterSpacing adds trailing space after the last glyph; nudge it back.
    marginLeft: 12,
  },
  codeInput: {
    fontSize: 34,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 10,
    textAlign: 'center',
    backgroundColor: '#1b1b22',
    borderRadius: 12,
    paddingVertical: 12,
    minWidth: 200,
  },
  primary: {
    backgroundColor: '#e50914',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginTop: 8,
  },
  primaryLabel: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondary: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3a3a44',
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  secondaryLabel: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
  divider: {
    color: '#6a6a74',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 8,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 14,
    textAlign: 'center',
  },
  memberHeading: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    marginTop: 8,
  },
  memberList: {
    alignSelf: 'stretch',
    gap: 8,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1b1b22',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  editNameButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberCounts: {
    color: '#9a9aa2',
    fontSize: 14,
  },
  hint: {
    color: '#6a6a74',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 12,
  },
});

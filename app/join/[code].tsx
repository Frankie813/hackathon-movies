// app/join/[code].tsx — where `moviematch://join/{CODE}` lands (issue #19).
//
// expo-router maps a deep link's path onto the file tree, so this file *is*
// the scheme handler; there is no Linking config to keep in sync. It does no
// joining of its own — it validates, hands the code to the group screen, and
// gets out of the way, so there is exactly one place that owns session state.

import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { requestJoin } from '@/lib/join-link';
import { isValidCode, normalizeCode } from '@/lib/session';

export default function JoinLinkScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const raw = params.code ?? '';
  const valid = isValidCode(raw);

  // requestJoin() notifies listeners synchronously, so it must not run during
  // render — an already-mounted group screen would set state mid-render.
  const [handed, setHanded] = useState(false);
  useEffect(() => {
    if (!valid) return;
    requestJoin(normalizeCode(raw));
    setHanded(true);
  }, [raw, valid]);

  if (valid) {
    // Wait for the handoff before leaving: on a cold start the group screen
    // mounts as a result of this redirect and reads the parked code then.
    if (!handed) return <View style={styles.container} />;
    return <Redirect href="/group" />;
  }

  // A mistyped or truncated code. Saying so beats silently redirecting to the
  // join screen, where the guest would retype the same bad code.
  return (
    <View style={styles.container}>
      <Text style={styles.title}>That link looks wrong</Text>
      <Text style={styles.body}>
        {raw ? `“${raw}” isn’t a join code.` : 'That link is missing a join code.'} Ask for the 4
        letters and type them in.
      </Text>
      <Link href="/group" style={styles.action}>
        Enter a code
      </Link>
    </View>
  );
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
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fff',
  },
  body: {
    fontSize: 15,
    color: '#9a9aa2',
    textAlign: 'center',
  },
  action: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3a3a44',
    paddingVertical: 12,
    paddingHorizontal: 28,
    overflow: 'hidden',
  },
});

import { useState } from 'react';
import { Button, ScrollView, Text, TextInput } from 'react-native';
import { apiCheckError, checkGemini, checkTmdb } from '../src/lib/api-smoke';

/** Development-only, manually triggered checks; never runs during startup. */
export default function ApiCheckScreen() {
  const [tmdbBearer, setTmdbBearer] = useState('');
  const [busy, setBusy] = useState(false);
  const [tmdbStatus, setTmdbStatus] = useState('TMDB: not checked');
  const [geminiStatus, setGeminiStatus] = useState('Gemini: not checked');

  if (!__DEV__) return null;

  async function runTmdb() {
    setBusy(true);
    setTmdbStatus('Checking TMDB…');
    try {
      setTmdbStatus(`TMDB passed: ${await checkTmdb(tmdbBearer)} discover results.`);
    } catch {
      setTmdbStatus('TMDB check failed. Verify the read token and network.');
    } finally {
      setBusy(false);
      setTmdbBearer('');
    }
  }

  async function runGemini() {
    setBusy(true);
    setGeminiStatus('Checking Gemini…');
    try {
      await checkGemini();
      setGeminiStatus('Gemini passed: expected JSON received through Firebase AI Logic.');
    } catch (error: unknown) {
      setGeminiStatus(apiCheckError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
      <Text accessibilityRole="header">Issue #3 API checks</Text>
      <Text>Manual development checks. Each Gemini check uses one request.</Text>
      <TextInput
        accessibilityLabel="TMDB API Read Access Token"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setTmdbBearer}
        placeholder="TMDB API Read Access Token"
        secureTextEntry
        editable={!busy}
        value={tmdbBearer}
      />
      <Button
        title="Check TMDB"
        disabled={busy || !tmdbBearer.trim()}
        onPress={() => void runTmdb()}
      />
      <Button title="Check Gemini" disabled={busy} onPress={() => void runGemini()} />
      <Text accessibilityLiveRegion="polite">{tmdbStatus}</Text>
      <Text accessibilityLiveRegion="polite">{geminiStatus}</Text>
    </ScrollView>
  );
}

// components/UsernamePrompt.tsx — create-or-edit window for the display name.
//
// One component backs three entry points: the first-launch onboarding gate
// (app/(tabs)/index.tsx), the edit button next to a member's own name in the
// Group tab, and the edit button on the Saved tab. "create" mode has no way
// out but confirming — a first-time guest must pick a name before the genre
// picker shows; "edit" mode adds a Cancel.

import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { USERNAME_MAX_LENGTH } from '@/src/lib/username';

export interface UsernamePromptProps {
  visible: boolean;
  mode: 'create' | 'edit';
  /** Prefilled value for "edit" mode. Ignored for "create". */
  initialValue?: string;
  onConfirm: (name: string) => void;
  /** Only offered in "edit" mode. */
  onCancel?: () => void;
}

export function UsernamePrompt({
  visible,
  mode,
  initialValue = '',
  onConfirm,
  onCancel,
}: UsernamePromptProps) {
  const [value, setValue] = useState(initialValue);

  // Re-seed the field whenever the window is (re)opened, so a cancelled edit
  // doesn't leave a stale draft behind for the next time it's opened.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;
  const confirm = () => {
    if (canConfirm) onConfirm(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={mode === 'edit' ? onCancel : undefined}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={styles.card}>
          <Text style={styles.title}>
            {mode === 'create' ? 'What should we call you?' : 'Edit your name'}
          </Text>
          <Text style={styles.subtitle}>
            This is just a display name for the group — it isn&apos;t tied to your
            account, so it&apos;s fine if someone else in the party picks the same one.
          </Text>

          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="Your name"
            placeholderTextColor="#5a5a64"
            maxLength={USERNAME_MAX_LENGTH}
            autoFocus
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={confirm}
            style={styles.input}
            accessibilityLabel="Your name"
          />

          <View style={styles.actions}>
            {mode === 'edit' && onCancel ? (
              <Pressable
                onPress={onCancel}
                accessibilityRole="button"
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={confirm}
              disabled={!canConfirm}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.primaryButton,
                !canConfirm && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryText}>{mode === 'create' ? 'Continue' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 14, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#14161f',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 24,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 20,
  },
  input: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
    backgroundColor: '#080d1a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 20,
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: '#fbbf24',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
  },
  primaryText: {
    color: '#080d1a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { Colors, Spacing, FontFamily } from '../theme';
import { listAccounts, addAccount, updateAccount } from '../store/accountsStore';

type Nav = NativeStackNavigationProp<RootStackParamList, 'AccountForm'>;
type Route = RouteProp<RootStackParamList, 'AccountForm'>;

export function AccountFormScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const accountId = route.params?.accountId;
  const isEditing = accountId !== undefined;

  const [nickname, setNickname] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    listAccounts().then(accounts => {
      const existing = accounts.find(a => a.id === accountId);
      if (existing) setNickname(existing.nickname);
    });
  }, [accountId]);

  const onSubmit = async () => {
    setError(null);
    if (!nickname.trim()) {
      setError('Account Nickname is required.');
      return;
    }
    if (!isEditing && !privateKey.trim()) {
      setError('Private Key is required.');
      return;
    }
    setSaving(true);
    try {
      if (isEditing) {
        await updateAccount(accountId!, { nickname, privateKeyInput: privateKey });
      } else {
        await addAccount(nickname, privateKey);
      }
      navigation.goBack();
    } catch (e) {
      const shaped = e as { message?: string };
      setError(shaped.message ?? 'Failed to save account.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{isEditing ? 'EDIT ACCOUNT' : 'ADD ACCOUNT'}</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Account Nickname</Text>
        <TextInput
          style={styles.input}
          value={nickname}
          onChangeText={setNickname}
          placeholder="e.g. Cold Storage"
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="words"
        />

        <Text style={styles.label}>Private Key</Text>
        <TextInput
          style={[styles.input, styles.inputMono]}
          value={privateKey}
          onChangeText={setPrivateKey}
          placeholder={isEditing ? 'Leave blank to keep existing key' : '0x...'}
          placeholderTextColor={Colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        {error !== null && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
          onPress={onSubmit}
          disabled={saving}
        >
          <Text style={styles.submitBtnText}>
            {isEditing ? 'SAVE CHANGES' : 'ADD ACCOUNT'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingTop: 52,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderGlow,
  },
  backBtn: {
    width: 60,
  },
  backText: {
    fontSize: 12,
    color: Colors.neonCyan,
    letterSpacing: 1,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.neonMagenta,
    letterSpacing: 3,
  },
  headerSpacer: {
    width: 60,
  },
  scroll: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  label: {
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: Spacing.xs,
    marginTop: Spacing.md,
  },
  input: {
    backgroundColor: Colors.bgCard,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    color: Colors.textPrimary,
    fontSize: 14,
    padding: Spacing.md,
  },
  inputMono: {
    fontFamily: FontFamily.mono,
    fontSize: 12,
  },
  error: {
    fontSize: 12,
    color: Colors.critical,
    marginTop: Spacing.md,
    lineHeight: 18,
  },
  submitBtn: {
    backgroundColor: Colors.neonCyan,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.xl,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitBtnText: {
    color: Colors.bgDeep,
    fontWeight: '700',
    letterSpacing: 1,
  },
});

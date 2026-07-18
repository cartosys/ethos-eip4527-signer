import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Spacing, FontFamily } from '../theme';

interface DgenError {
  code: string;
  message: string;
  recoverable: boolean;
}

interface Props {
  error: DgenError;
  onRetry?: () => void;
  onBack?: () => void;
}

export function ErrorView({ error, onRetry, onBack }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.icon}>⚠</Text>
        <Text style={styles.code}>{error.code}</Text>
        <Text style={styles.message}>{error.message}</Text>
        {error.recoverable && onRetry ? (
          <TouchableOpacity style={styles.btnRetry} onPress={onRetry}>
            <Text style={styles.btnRetryText}>TRY AGAIN</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.btnBack} onPress={onBack}>
            <Text style={styles.btnBackText}>BACK TO SCANNER</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.bgDeep,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.critical,
    padding: Spacing.lg,
    alignItems: 'center',
    shadowColor: Colors.critical,
    shadowRadius: 12,
    shadowOpacity: 0.5,
    elevation: 8,
  },
  icon: {
    fontSize: 40,
    marginBottom: Spacing.md,
  },
  code: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    color: Colors.critical,
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  message: {
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  btnRetry: {
    backgroundColor: Colors.neonCyan,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: 8,
  },
  btnRetryText: {
    color: Colors.bgDeep,
    fontWeight: '700',
    letterSpacing: 1,
  },
  btnBack: {
    borderWidth: 1,
    borderColor: Colors.textSecondary,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: 8,
  },
  btnBackText: {
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
});

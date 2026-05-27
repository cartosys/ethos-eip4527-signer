import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Spacing, FontFamily } from '../theme';

type ActionType = 'transfer' | 'approve' | 'swap' | 'contract-call' | 'signature' | 'unknown';

const ACTION_COLORS: Record<ActionType, string> = {
  transfer:      Colors.neonCyan,
  approve:       Colors.medium,
  swap:          Colors.neonPurple,
  'contract-call': Colors.neonMagenta,
  signature:     Colors.neonGreen,
  unknown:       Colors.textSecondary,
};

interface Props {
  type: ActionType;
}

export function ActionBadge({ type }: Props) {
  const color = ACTION_COLORS[type] ?? Colors.textSecondary;
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.label, { color }]}>{type.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: Colors.bgElevated,
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    letterSpacing: 0.8,
  },
});

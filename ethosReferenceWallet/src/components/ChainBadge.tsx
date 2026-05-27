import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, ChainColors, Spacing, FontFamily } from '../theme';

interface Props {
  chain: string;
  chainId?: number;
}

export function ChainBadge({ chain, chainId }: Props) {
  const dotColor = ChainColors[chain] ?? Colors.neonPurple;
  return (
    <View style={styles.badge}>
      <View style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={styles.label}>
        {chain.toUpperCase()}{chainId !== undefined ? ` (${chainId})` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.neonPurple,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: Spacing.xs,
  },
  label: {
    fontFamily: FontFamily.mono,
    fontSize: 11,
    color: Colors.textPrimary,
    letterSpacing: 0.8,
  },
});

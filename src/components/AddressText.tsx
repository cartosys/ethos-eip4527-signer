import React, { useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, FontFamily, Spacing } from '../theme';
import { truncateAddress } from '../theme';

interface Props {
  address: string;
  label?: string;
}

export function AddressText({ address, label }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <TouchableOpacity onPress={() => setExpanded(v => !v)} activeOpacity={0.7}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <Text style={styles.address} numberOfLines={expanded ? undefined : 1}>
        {expanded ? address : truncateAddress(address)}
      </Text>
      <Text style={styles.hint}>{expanded ? 'tap to collapse' : 'tap to expand'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
  },
  address: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    color: Colors.textMono,
    letterSpacing: 0.5,
  },
  hint: {
    fontSize: 10,
    color: Colors.borderGlow,
    marginTop: 2,
  },
});

import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Colors, SeverityColors, Spacing } from '../theme';

type Severity = 'low' | 'medium' | 'high' | 'critical';

interface Warning {
  severity: Severity;
  code: string;
  message: string;
}

interface Props {
  warning: Warning;
}

const ICONS: Record<Severity, string> = {
  critical: '🔴',
  high:     '🟠',
  medium:   '🟡',
  low:      '⚪',
};

export function WarningRow({ warning }: Props) {
  const color = SeverityColors[warning.severity] ?? Colors.low;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (warning.severity !== 'critical') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [warning.severity, pulseAnim]);

  return (
    <Animated.View
      style={[
        styles.row,
        { borderLeftColor: color },
        warning.severity === 'critical' && { opacity: pulseAnim },
      ]}
    >
      <Text style={styles.icon}>{ICONS[warning.severity]}</Text>
      <View style={styles.textBlock}>
        <Text style={[styles.code, { color }]}>{warning.code}</Text>
        <Text style={styles.message}>{warning.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: Colors.bgElevated,
    borderLeftWidth: 4,
    borderRadius: 6,
    padding: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  icon: {
    fontSize: 14,
    marginRight: Spacing.sm,
    marginTop: 1,
  },
  textBlock: {
    flex: 1,
  },
  code: {
    fontSize: 11,
    letterSpacing: 0.8,
    fontWeight: '600',
    marginBottom: 2,
  },
  message: {
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
});

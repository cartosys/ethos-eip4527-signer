import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Colors, Spacing, FontFamily } from '../theme';
import { TEST_SCENARIOS } from '../dev/testScenarios';
import type { TestScenario } from '../dev/testScenarios';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Simulator'>;

const BADGE_COLOR: Record<TestScenario['badge'], string> = {
  green:  Colors.neonGreen,
  yellow: Colors.medium,
  red:    Colors.critical,
};

const BADGE_LABEL: Record<TestScenario['badge'], string> = {
  green:  'PASS',
  yellow: 'WARN',
  red:    'CRITICAL',
};

export function SimulatorScreen() {
  const navigation = useNavigation<Nav>();

  const runScenario = (s: TestScenario) => {
    if (s.scenario.type === 'ur') {
      navigation.push('Scanner', { initialFragment: s.scenario.fragment });
    } else {
      const { json, signDataHex, requestIdHex, origin } = s.scenario;
      navigation.navigate('TxReview', { envelopeJson: json, signDataHex, requestIdHex, origin });
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>DEV SIMULATOR</Text>
          <Text style={styles.headerSub}>End-to-end architecture test</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        <Text style={styles.sectionLabel}>PIPELINE COVERAGE</Text>

        {TEST_SCENARIOS.map(s => (
          <TouchableOpacity
            key={s.id}
            style={styles.card}
            onPress={() => runScenario(s)}
            activeOpacity={0.7}
          >
            <View style={[styles.cardAccent, { backgroundColor: BADGE_COLOR[s.badge] }]} />

            <View style={styles.cardBody}>
              <View style={styles.cardRow}>
                <Text style={styles.cardLabel}>{s.label}</Text>
                <View style={[styles.badge, { borderColor: BADGE_COLOR[s.badge] }]}>
                  <Text style={[styles.badgeText, { color: BADGE_COLOR[s.badge] }]}>
                    {BADGE_LABEL[s.badge]}
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDesc}>{s.description}</Text>

              <View style={styles.kindRow}>
                <View style={[
                  styles.kindTag,
                  s.scenario.type === 'ur' ? styles.kindTagUr : styles.kindTagEnvelope,
                ]}>
                  <Text style={[
                    styles.kindTagText,
                    s.scenario.type === 'ur' ? styles.kindTagTextUr : styles.kindTagTextEnvelope,
                  ]}>
                    {s.scenario.type === 'ur' ? 'UR DECODE' : 'DIRECT'}
                  </Text>
                </View>
                <Text style={styles.tapHint}>TAP TO RUN →</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))}

        <View style={styles.legend}>
          <Text style={styles.legendTitle}>LEGEND</Text>
          <Text style={styles.legendItem}>
            <Text style={styles.legendKey}>UR DECODE</Text>
            {'  '}Full pipeline: UR decode → envelope build → TxReview → sign → SigningResult
          </Text>
          <Text style={styles.legendItem}>
            <Text style={styles.legendKey}>DIRECT</Text>
            {'    '}Skips UR layer; injects crafted envelope directly into TxReview
          </Text>
        </View>

        <Text style={styles.devNote}>
          DEV MODE ONLY — signed with Hardhat test key{'\n'}
          Not for production use
        </Text>

      </ScrollView>
    </View>
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
  headerSub: {
    fontSize: 10,
    color: Colors.textSecondary,
    letterSpacing: 1,
    marginTop: 2,
  },
  headerSpacer: {
    width: 60,
  },
  scroll: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  sectionLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
  },
  cardAccent: {
    width: 4,
  },
  cardBody: {
    flex: 1,
    padding: Spacing.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xs,
  },
  cardLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 9,
    fontFamily: FontFamily.mono,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardDesc: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 16,
    marginBottom: Spacing.sm,
  },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kindTag: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kindTagUr: {
    backgroundColor: Colors.glowCyan,
  },
  kindTagEnvelope: {
    backgroundColor: Colors.glowMagenta,
  },
  kindTagText: {
    fontSize: 9,
    fontFamily: FontFamily.mono,
    fontWeight: '700',
    letterSpacing: 1,
  },
  kindTagTextUr: {
    color: Colors.neonCyan,
  },
  kindTagTextEnvelope: {
    color: Colors.neonMagenta,
  },
  tapHint: {
    fontSize: 9,
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  legend: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    padding: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  legendTitle: {
    fontSize: 10,
    color: Colors.textSecondary,
    letterSpacing: 2,
    marginBottom: Spacing.sm,
  },
  legendItem: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: Spacing.xs,
  },
  legendKey: {
    fontFamily: FontFamily.mono,
    color: Colors.textPrimary,
    fontSize: 11,
  },
  devNote: {
    fontSize: 10,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
    opacity: 0.5,
  },
});

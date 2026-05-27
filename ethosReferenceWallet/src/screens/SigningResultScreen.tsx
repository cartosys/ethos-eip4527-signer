import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  StatusBar,
  ScrollView,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { Colors, Spacing, FontFamily } from '../theme';

type Nav   = NativeStackNavigationProp<RootStackParamList, 'SigningResult'>;
type Route = RouteProp<RootStackParamList, 'SigningResult'>;

function truncateTx(tx: string): string {
  if (tx.length < 20) return tx;
  return `${tx.slice(0, 10)}…${tx.slice(-8)}`;
}

export function SigningResultScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { signedTx, signerAddress, elapsedMs } = route.params;

  const scaleAnim   = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(scaleAnim,   { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [scaleAnim, opacityAnim]);

  const handleCopy = () => {
    Clipboard.setString(signedTx);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleScanAnother = () => {
    navigation.popToTop();
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Animated checkmark */}
        <Animated.View style={[styles.iconWrap, { transform: [{ scale: scaleAnim }] }]}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>✓</Text>
          </View>
        </Animated.View>

        <Animated.View style={{ opacity: opacityAnim }}>
          <Text style={styles.title}>TRANSACTION SIGNED</Text>
          <Text style={styles.subtitle}>Signature produced successfully</Text>

          <View style={styles.card}>
            <Text style={styles.fieldLabel}>SIGNED TX</Text>
            <Text style={styles.txHash} numberOfLines={2}>{truncateTx(signedTx)}</Text>

            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>SIGNER ADDRESS</Text>
            <Text style={styles.mono}>{signerAddress}</Text>

            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>SIGNING TIME</Text>
            <Text style={styles.mono}>{elapsedMs} ms</Text>
          </View>

          <TouchableOpacity style={styles.btnCopy} onPress={handleCopy}>
            <Text style={styles.btnCopyText}>
              {copied ? '✓ COPIED' : 'COPY SIGNED TX'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.btnScanAnother} onPress={handleScanAnother}>
            <Text style={styles.btnScanAnotherText}>SCAN ANOTHER</Text>
          </TouchableOpacity>

          <Text style={styles.devNote}>
            ⚠ DEV MODE — signed with Hardhat test key #{'\n'}
            Not for production use
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },
  scroll: {
    flexGrow: 1,
    padding: Spacing.lg,
    paddingTop: Spacing.xxl,
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: Spacing.lg,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.bgCard,
    borderWidth: 2,
    borderColor: Colors.neonGreen,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.neonGreen,
    shadowRadius: 16,
    shadowOpacity: 0.8,
    elevation: 10,
  },
  iconText: {
    fontSize: 48,
    color: Colors.neonGreen,
    lineHeight: 56,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: Spacing.xs,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  card: {
    width: '100%',
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
  },
  txHash: {
    fontFamily: FontFamily.mono,
    fontSize: 13,
    color: Colors.textMono,
    marginBottom: Spacing.sm,
  },
  mono: {
    fontFamily: FontFamily.mono,
    fontSize: 12,
    color: Colors.textMono,
    marginBottom: Spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderGlow,
    marginVertical: Spacing.sm,
  },
  btnCopy: {
    width: '100%',
    backgroundColor: Colors.neonCyan,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  btnCopyText: {
    color: Colors.bgDeep,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  btnScanAnother: {
    width: '100%',
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  btnScanAnotherText: {
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
  devNote: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    opacity: 0.6,
  },
});

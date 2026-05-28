import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ethers } from 'ethers';
import { URDecoder } from '@ngraveio/bc-ur';
import type { RootStackParamList } from '../navigation/types';
import { newUrDecoder, decodeUrFragment, assembleSignRequest, toHex } from '../urDecoder';
import { ScanReticle } from '../components/ScanReticle';
import { ErrorView } from '../components/ErrorView';
import { Colors, Spacing } from '../theme';

type Nav   = NativeStackNavigationProp<RootStackParamList, 'Scanner'>;
type Route = RouteProp<RootStackParamList, 'Scanner'>;

const CHAIN_NAMES: Record<number, string> = {
  1:     'ethereum',
  42161: 'arbitrum',
  10:    'optimism',
  8453:  'base',
  137:   'polygon',
};

function buildEnvelope(signData: Uint8Array, chainId: number, origin?: string): Record<string, unknown> {
  try {
    const hex = toHex(signData);
    const parsed = ethers.Transaction.from(hex);
    return {
      chain:                CHAIN_NAMES[chainId] ?? 'ethereum',
      to:                   parsed.to ?? undefined,
      value:                parsed.value?.toString(),
      nonce:                parsed.nonce,
      gasLimit:             parsed.gasLimit?.toString(),
      maxFeePerGas:         parsed.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: parsed.maxPriorityFeePerGas?.toString(),
      data:                 parsed.data !== '0x' ? parsed.data : undefined,
      chainId:              chainId,
      type:                 'eip1559' as const,
      metadata:             origin ? { origin } : undefined,
    };
  } catch {
    return {
      chain:   CHAIN_NAMES[chainId] ?? 'ethereum',
      chainId: chainId,
      type:    'eip1559' as const,
      metadata: origin ? { origin } : undefined,
    };
  }
}

export function ScannerScreen() {
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const decoderRef  = useRef<URDecoder>(newUrDecoder());
  const seenRef     = useRef(new Set<string>());
  const processingRef = useRef(false);

  const [fragmentCount, setFragmentCount] = useState(0);
  const [error, setError] = useState<{ code: string; message: string; recoverable: boolean } | null>(null);

  const resetScanner = useCallback(() => {
    decoderRef.current = newUrDecoder();
    seenRef.current.clear();
    processingRef.current = false;
    setFragmentCount(0);
    setError(null);
  }, []);

  const handleFragment = useCallback((fragment: string) => {
    if (processingRef.current) return;
    if (seenRef.current.has(fragment)) return;
    seenRef.current.add(fragment);

    const complete = decodeUrFragment(decoderRef.current, fragment);
    setFragmentCount(seenRef.current.size);

    if (!complete && !decoderRef.current.isComplete()) return;

    processingRef.current = true;
    try {
      const parsed = assembleSignRequest(decoderRef.current);
      const envelope = buildEnvelope(parsed.signData, parsed.chainId, parsed.origin);
      navigation.navigate('TxReview', {
        envelopeJson: JSON.stringify(envelope),
        signDataHex:  toHex(parsed.signData),
        requestIdHex: toHex(parsed.requestId),
        origin:       parsed.origin,
      });
    } catch (err) {
      processingRef.current = false;
      setError(err as { code: string; message: string; recoverable: boolean });
    }
  }, [navigation]);

  // When launched by the Simulator with a pre-set UR, fire it once on mount.
  // handleFragment is stable (memoized on navigation) so this effect runs exactly once.
  const initialFragment = route.params?.initialFragment;
  useEffect(() => {
    if (initialFragment) handleFragment(initialFragment);
  }, [handleFragment, initialFragment]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: { value?: string }[]) => {
      const value = codes[0]?.value;
      if (value) handleFragment(value);
    },
  });

  if (error) {
    return <ErrorView error={error} onRetry={resetScanner} onBack={resetScanner} />;
  }

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permSubtitle}>
          The camera is used to scan EIP-4527 QR codes.
          No images are stored or transmitted.
        </Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>GRANT PERMISSION</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.neonCyan} size="large" />
        <Text style={styles.loadingText}>Initializing camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        codeScanner={codeScanner}
      />

      {/* Dark vignette overlay */}
      <View style={styles.vignette} pointerEvents="none" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>SCAN QR</Text>
        <Text style={styles.headerSub}>EIP-4527 · UR / CBOR</Text>
      </View>

      {/* Reticle */}
      <View style={styles.reticleWrap}>
        <ScanReticle />
        {fragmentCount > 1 && (
          <Text style={styles.fragmentCount}>{fragmentCount} frames</Text>
        )}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Point at an animated QR code from your watch-only wallet
        </Text>

        {__DEV__ && (
          <TouchableOpacity
            style={styles.devBtn}
            onPress={() => navigation.navigate('Simulator')}
          >
            <Text style={styles.devBtnText}>⚡ DEV MENU</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  vignette: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
    borderWidth: 80,
    borderColor: 'rgba(10,10,26,0.75)',
  },
  header: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 4,
  },
  headerSub: {
    fontSize: 12,
    color: Colors.neonCyan,
    letterSpacing: 2,
    marginTop: 4,
  },
  reticleWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fragmentCount: {
    marginTop: Spacing.md,
    fontSize: 12,
    color: Colors.neonCyan,
    letterSpacing: 1,
  },
  footer: {
    position: 'absolute',
    bottom: 48,
    left: Spacing.xl,
    right: Spacing.xl,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  permTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.md,
    textAlign: 'center',
  },
  permSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.xl,
  },
  permBtn: {
    backgroundColor: Colors.neonCyan,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    borderRadius: 8,
  },
  permBtnText: {
    color: Colors.bgDeep,
    fontWeight: '700',
    letterSpacing: 1,
  },
  loadingText: {
    marginTop: Spacing.md,
    color: Colors.textSecondary,
    fontSize: 14,
  },
  devBtn: {
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.neonMagenta,
    borderRadius: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  devBtnText: {
    color: Colors.neonMagenta,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});

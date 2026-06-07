import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
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

function hexToNum(v: unknown): number | undefined {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = v.startsWith('0x') ? parseInt(v, 16) : parseInt(v, 10);
    return isNaN(n) ? undefined : n;
  }
  return undefined;
}

function normalizeRawTx(raw: Record<string, unknown>): Record<string, unknown> {
  const chainId = hexToNum(raw.chainId) ?? 1;
  return {
    chain:                CHAIN_NAMES[chainId] ?? 'ethereum',
    chainId,
    to:                   raw.to,
    from:                 raw.from,
    value:                raw.value,
    nonce:                hexToNum(raw.nonce),
    gasLimit:             raw.gasLimit,
    // EIP-1559 fields; fall back to legacy gasPrice for pre-EIP-1559 objects
    maxFeePerGas:         raw.maxFeePerGas ?? raw.gasPrice,
    maxPriorityFeePerGas: raw.maxPriorityFeePerGas,
    data:                 raw.data,
    type:                 'eip1559' as const,
  };
}

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
  const [lastRaw, setLastRaw] = useState<string | null>(null);
  const [urInputVisible, setUrInputVisible] = useState(false);
  const [urInputText, setUrInputText] = useState('');
  const [urInputError, setUrInputError] = useState<string | null>(null);

  const resetScanner = useCallback(() => {
    decoderRef.current = newUrDecoder();
    seenRef.current.clear();
    processingRef.current = false;
    setFragmentCount(0);
    setError(null);
    setLastRaw(null);
    setUrInputText('');
    setUrInputError(null);
    setUrInputVisible(false);
  }, []);

  const handleFragment = useCallback((fragment: string) => {
    if (__DEV__) setLastRaw(fragment.slice(0, 60));
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

  const submitUrInput = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setUrInputError('Nothing pasted — enter a JSON object or ur: string.');
      return;
    }

    if (trimmed.startsWith('{')) {
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(trimmed) as Record<string, unknown>;
      } catch (e) {
        setUrInputError('Invalid JSON: ' + (e instanceof Error ? e.message : 'parse error'));
        return;
      }
      const envelope = normalizeRawTx(raw);
      setUrInputError(null);
      setUrInputVisible(false);
      navigation.navigate('TxReview', {
        envelopeJson: JSON.stringify(envelope),
        signDataHex:  '0x(manual)',
        requestIdHex: '0x',
      });
      return;
    }

    if (trimmed.toLowerCase().startsWith('ur:')) {
      setUrInputError(null);
      setUrInputVisible(false);
      handleFragment(trimmed);
      return;
    }

    setUrInputError('Must start with { (JSON) or ur: (UR fragment).');
  }, [navigation, handleFragment]);

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
        pixelFormat="yuv"
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
          <>
            {lastRaw !== null ? (
              <Text style={styles.devScan}>
                SCAN: {lastRaw.startsWith('ur:') ? '✓ UR' : '✗ NOT UR'} — {lastRaw}
              </Text>
            ) : (
              <Text style={styles.devScan}>SCAN: waiting… (camera not delivering frames)</Text>
            )}
            <View style={styles.devRow}>
              <TouchableOpacity
                style={styles.devBtn}
                onPress={() => navigation.navigate('Simulator')}
              >
                <Text style={styles.devBtnText}>⚡ DEV MENU</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.devBtn, styles.devBtnCyan]}
                onPress={() => { setUrInputText(''); setUrInputError(null); setUrInputVisible(true); }}
              >
                <Text style={[styles.devBtnText, styles.devBtnTextCyan]}>PASTE UR</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
      {__DEV__ && (
        <Modal
          visible={urInputVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setUrInputVisible(false)}
        >
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalBox}>
              <Text style={styles.modalTitle}>PASTE UR / JSON</Text>
              <Text style={styles.modalSub}>
                Paste a ur:eth-sign-request/… string, or a raw JSON transaction object
              </Text>
              <TextInput
                style={styles.modalInput}
                value={urInputText}
                onChangeText={t => { setUrInputText(t); setUrInputError(null); }}
                placeholder="ur:eth-sign-request/… or { … } JSON"
                placeholderTextColor={Colors.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              {urInputError !== null && (
                <Text style={styles.modalError}>{urInputError}</Text>
              )}
              <View style={styles.modalRow}>
                <TouchableOpacity
                  style={styles.modalBtnCancel}
                  onPress={() => setUrInputVisible(false)}
                >
                  <Text style={styles.modalBtnCancelText}>CANCEL</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalBtnSubmit}
                  onPress={() => submitUrInput(urInputText)}
                >
                  <Text style={styles.modalBtnSubmitText}>SUBMIT</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      )}
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
  devScan: {
    marginTop: Spacing.sm,
    fontSize: 10,
    color: Colors.neonCyan,
    fontFamily: 'monospace',
    textAlign: 'center',
    opacity: 0.8,
  },
  devRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  devBtn: {
    borderWidth: 1,
    borderColor: Colors.neonMagenta,
    borderRadius: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  devBtnCyan: {
    borderColor: Colors.neonCyan,
  },
  devBtnText: {
    color: Colors.neonMagenta,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  devBtnTextCyan: {
    color: Colors.neonCyan,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  modalBox: {
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    padding: Spacing.lg,
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.neonCyan,
    letterSpacing: 2,
    marginBottom: Spacing.xs,
  },
  modalSub: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    lineHeight: 16,
  },
  modalInput: {
    backgroundColor: Colors.bgDeep,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    color: Colors.textPrimary,
    fontSize: 11,
    fontFamily: 'monospace',
    padding: Spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: Spacing.md,
  },
  modalError: {
    fontSize: 11,
    color: Colors.critical,
    marginBottom: Spacing.sm,
    lineHeight: 16,
  },
  modalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  modalBtnCancel: {
    borderWidth: 1,
    borderColor: Colors.textSecondary,
    borderRadius: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  modalBtnCancelText: {
    color: Colors.textSecondary,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  modalBtnSubmit: {
    backgroundColor: Colors.neonCyan,
    borderRadius: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  modalBtnSubmitText: {
    color: Colors.bgDeep,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});

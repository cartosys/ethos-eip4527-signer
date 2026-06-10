import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  Modal,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { ChainBadge } from '../components/ChainBadge';
import { ActionBadge } from '../components/ActionBadge';
import { AddressText } from '../components/AddressText';
import { WarningRow } from '../components/WarningRow';
import { ErrorView } from '../components/ErrorView';
import { signLocally } from '../localSigner';
import { Colors, Spacing, FontFamily, formatEth, formatGwei } from '../theme';

type Nav  = NativeStackNavigationProp<RootStackParamList, 'TxReview'>;
type Route = RouteProp<RootStackParamList, 'TxReview'>;

type Severity = 'low' | 'medium' | 'high' | 'critical';
interface Warning { severity: Severity; code: string; message: string; }

function deriveActionType(data?: string): 'transfer' | 'contract-call' | 'unknown' {
  if (!data || data === '0x' || data === '') return 'transfer';
  return 'contract-call';
}

function isZeroOrMissing(v: unknown): boolean {
  if (v == null || v === '' || v === '0x') return true;
  try { return BigInt(v as string) === 0n; } catch { return true; }
}

function deriveWarnings(envelope: Record<string, unknown>): Warning[] {
  const warnings: Warning[] = [];
  if (!envelope.to) {
    warnings.push({ severity: 'critical', code: 'NO_RECIPIENT', message: 'No recipient address — contract deploy or malformed transaction.' });
  }
  if (isZeroOrMissing(envelope.maxFeePerGas)) {
    warnings.push({ severity: 'critical', code: 'ZERO_MAX_FEE', message: 'maxFeePerGas is zero or missing — network will reject this transaction as underpriced.' });
  }
  if (isZeroOrMissing(envelope.maxPriorityFeePerGas)) {
    warnings.push({ severity: 'high', code: 'ZERO_PRIORITY_FEE', message: 'maxPriorityFeePerGas is zero — validators are unlikely to include this transaction.' });
  }
  if (envelope.value === '0' || envelope.value === undefined) {
    if (!envelope.data || envelope.data === '0x') {
      warnings.push({ severity: 'medium', code: 'ZERO_VALUE', message: 'Zero value with no calldata — this transaction has no apparent effect.' });
    }
  }
  return warnings;
}

function FieldRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={fieldStyles.row}>
      <Text style={fieldStyles.label}>{label}</Text>
      <Text style={[fieldStyles.value, mono && { fontFamily: FontFamily.mono, color: Colors.textMono }]}>
        {value}
      </Text>
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderGlow,
  },
  label: {
    fontSize: 12,
    color: Colors.textSecondary,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    flex: 1,
  },
  value: {
    fontSize: 14,
    color: Colors.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
});

export function TxReviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { envelopeJson, signDataHex, origin } = route.params;

  const envelope = useMemo<Record<string, unknown>>(() => {
    try { return JSON.parse(envelopeJson) as Record<string, unknown>; }
    catch { return {}; }
  }, [envelopeJson]);

  const actionType = deriveActionType(envelope.data as string | undefined);
  const warnings   = useMemo(() => deriveWarnings(envelope), [envelope]);
  const hasCritical = warnings.some(w => w.severity === 'critical');

  const [signing, setSigning]     = useState(false);
  const [confirmRisk, setConfirmRisk] = useState(false);
  const [error, setError]         = useState<{ code: string; message: string; recoverable: boolean } | null>(null);

  const doSign = async () => {
    setSigning(true);
    setConfirmRisk(false);
    try {
      const result = await signLocally({
        to:                   envelope.to as string | undefined,
        value:                envelope.value as string | undefined,
        nonce:                envelope.nonce as number | undefined,
        gasLimit:             envelope.gasLimit as string | undefined,
        maxFeePerGas:         envelope.maxFeePerGas as string | undefined,
        maxPriorityFeePerGas: envelope.maxPriorityFeePerGas as string | undefined,
        data:                 envelope.data as string | undefined,
        chainId:              envelope.chainId as number | undefined,
      });
      navigation.navigate('SigningResult', {
        signedTx:      result.signedTx,
        signerAddress: result.signerAddress,
        elapsedMs:     result.elapsedMs,
      });
    } catch (err) {
      setSigning(false);
      setError(err as { code: string; message: string; recoverable: boolean });
    }
  };

  const onSignPress = () => {
    if (hasCritical) { setConfirmRisk(true); return; }
    doSign();
  };

  if (error) {
    return <ErrorView error={error} onRetry={() => setError(null)} onBack={() => navigation.goBack()} />;
  }

  const chain   = (envelope.chain   as string | undefined) ?? 'ethereum';
  const chainId = envelope.chainId as number | undefined;
  const value   = envelope.value   as string | undefined;
  const gasLimit = envelope.gasLimit as string | undefined;
  const maxFee   = envelope.maxFeePerGas as string | undefined;
  const maxPriority = envelope.maxPriorityFeePerGas as string | undefined;
  const nonce    = envelope.nonce as number | undefined;
  const data     = envelope.data as string | undefined;

  const warningShield = hasCritical ? '🔴' : warnings.some(w => w.severity === 'high') ? '🟠' : warnings.length > 0 ? '🟡' : '🟢';

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>REVIEW TRANSACTION</Text>
        <Text style={styles.warningShield}>{warningShield}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Badge row */}
        <View style={styles.badgeRow}>
          <ChainBadge chain={chain} chainId={chainId} />
          <View style={styles.badgeSpacer} />
          <ActionBadge type={actionType} />
        </View>

        {/* Origin */}
        {origin ? (
          <Text style={styles.origin}>Origin: {origin}</Text>
        ) : null}

        {/* Addresses */}
        <View style={styles.card}>
          {(envelope.from as string | undefined) ? (
            <View style={styles.addrRow}>
              <AddressText address={envelope.from as string} label="From" />
            </View>
          ) : null}
          {(envelope.to as string | undefined) ? (
            <View style={styles.addrRow}>
              <AddressText address={envelope.to as string} label="To" />
            </View>
          ) : (
            <Text style={styles.noRecipient}>⚠ No recipient address</Text>
          )}
        </View>

        {/* Transaction fields */}
        <View style={styles.card}>
          {value       !== undefined ? <FieldRow label="Value"          value={formatEth(value)}     /> : null}
          {gasLimit    !== undefined ? <FieldRow label="Gas Limit"      value={gasLimit}              mono /> : null}
          {maxFee      !== undefined ? <FieldRow label="Max Fee"        value={formatGwei(maxFee)}    /> : null}
          {maxPriority !== undefined ? <FieldRow label="Priority Fee"   value={formatGwei(maxPriority)} /> : null}
          {nonce       !== undefined ? <FieldRow label="Nonce"          value={String(nonce)}         mono /> : null}
          {data && data !== '0x' ? (
            <View style={fieldStyles.row}>
              <Text style={fieldStyles.label}>Data</Text>
              <Text style={[fieldStyles.value, { fontFamily: FontFamily.mono, color: Colors.neonMagenta, fontSize: 12 }]}>
                {data.slice(0, 22)}…
              </Text>
            </View>
          ) : null}
          <View style={fieldStyles.row}>
            <Text style={fieldStyles.label}>Sign Data</Text>
            <Text style={[fieldStyles.value, { fontFamily: FontFamily.mono, fontSize: 11, color: Colors.textSecondary }]}>
              {signDataHex.slice(0, 14)}…
            </Text>
          </View>
        </View>

        {/* Warnings */}
        {warnings.length > 0 && (
          <View style={styles.warningsSection}>
            <Text style={styles.warningSectionTitle}>SECURITY WARNINGS</Text>
            {warnings.map((w, i) => <WarningRow key={i} warning={w} />)}
          </View>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.btnReject}
            onPress={() => navigation.goBack()}
            disabled={signing}
          >
            <Text style={styles.btnRejectText}>REJECT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btnSign, hasCritical && styles.btnSignRisk, signing && styles.btnDisabled]}
            onPress={onSignPress}
            disabled={signing}
          >
            {signing
              ? <ActivityIndicator color={Colors.bgDeep} size="small" />
              : <Text style={styles.btnSignText}>
                  {hasCritical ? 'SIGN ANYWAY ⚠' : 'SIGN'}
                </Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Critical risk confirmation modal */}
      <Modal transparent visible={confirmRisk} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>⚠ CRITICAL RISK</Text>
            <Text style={styles.modalBody}>
              This transaction has critical security warnings. Signing may result in
              irreversible asset loss. Are you sure you want to proceed?
            </Text>
            <TouchableOpacity style={styles.modalBtnSign} onPress={doSign}>
              <Text style={styles.modalBtnSignText}>I UNDERSTAND — SIGN ANYWAY</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setConfirmRisk(false)}>
              <Text style={styles.modalBtnCancelText}>CANCEL</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
    paddingRight: Spacing.sm,
  },
  backText: {
    fontSize: 12,
    color: Colors.neonCyan,
    letterSpacing: 1,
  },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 2,
    textAlign: 'center',
  },
  warningShield: {
    fontSize: 20,
  },
  scroll: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  badgeSpacer: {
    width: Spacing.sm,
  },
  origin: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: Spacing.md,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  addrRow: {
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderGlow,
  },
  noRecipient: {
    color: Colors.critical,
    fontSize: 13,
    paddingVertical: Spacing.sm,
  },
  warningsSection: {
    marginBottom: Spacing.md,
  },
  warningSectionTitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    letterSpacing: 1.5,
    marginBottom: Spacing.sm,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  btnReject: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.critical,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  btnRejectText: {
    color: Colors.critical,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  btnSign: {
    flex: 2,
    backgroundColor: Colors.neonCyan,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  btnSignRisk: {
    backgroundColor: Colors.high,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnSignText: {
    color: Colors.bgDeep,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  modalCard: {
    width: '100%',
    backgroundColor: Colors.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.critical,
    padding: Spacing.lg,
    shadowColor: Colors.critical,
    shadowRadius: 16,
    shadowOpacity: 0.5,
    elevation: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.critical,
    marginBottom: Spacing.md,
    textAlign: 'center',
    letterSpacing: 1,
  },
  modalBody: {
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: Spacing.xl,
  },
  modalBtnSign: {
    backgroundColor: Colors.critical,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  modalBtnSignText: {
    color: Colors.textPrimary,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontSize: 13,
  },
  modalBtnCancel: {
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    borderRadius: 8,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
  },
  modalBtnCancelText: {
    color: Colors.textSecondary,
    letterSpacing: 1,
  },
});

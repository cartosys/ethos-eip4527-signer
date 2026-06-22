import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Modal,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { Colors, Spacing, FontFamily } from '../theme';
import { listAccounts, removeAccount, type Account } from '../store/accountsStore';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Accounts'>;

function abbreviateAddress(address: string): string {
  if (address.length < 8) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function AccountsListScreen() {
  const navigation = useNavigation<Nav>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pendingDelete, setPendingDelete] = useState<Account | null>(null);

  const refresh = useCallback(() => {
    listAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await removeAccount(pendingDelete.id);
    setPendingDelete(null);
    refresh();
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.bgDeep} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← BACK</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>ACCOUNTS</Text>
          <Text style={styles.headerSub}>Manage stored keys</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {accounts.length === 0 ? (
          <Text style={styles.emptyText}>No accounts yet</Text>
        ) : (
          accounts.map(account => (
            <View key={account.id} style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.rowNickname}>{account.nickname}</Text>
                <Text style={styles.rowAddress}>{abbreviateAddress(account.address)}</Text>
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => navigation.navigate('AccountForm', { accountId: account.id })}
                >
                  <Text style={styles.iconBtnText}>✎</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => setPendingDelete(account)}
                >
                  <Text style={[styles.iconBtnText, styles.iconBtnDanger]}>🗑</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate('AccountForm', {})}
        >
          <Text style={styles.addBtnText}>ADD ACCOUNT</Text>
        </TouchableOpacity>
      </View>

      <Modal transparent visible={pendingDelete !== null} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>⚠ REMOVE ACCOUNT</Text>
            <Text style={styles.modalBody}>
              Remove "{pendingDelete?.nickname}" and its stored private key? This cannot be undone.
            </Text>
            <TouchableOpacity style={styles.modalBtnRemove} onPress={confirmDelete}>
              <Text style={styles.modalBtnRemoveText}>REMOVE</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={() => setPendingDelete(null)}>
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
  emptyText: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  rowInfo: {
    flex: 1,
  },
  rowNickname: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
    letterSpacing: 0.5,
  },
  rowAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontFamily: FontFamily.mono,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  iconBtn: {
    borderWidth: 1,
    borderColor: Colors.borderGlow,
    borderRadius: 6,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  iconBtnText: {
    fontSize: 14,
    color: Colors.neonCyan,
  },
  iconBtnDanger: {
    color: Colors.critical,
  },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.borderGlow,
  },
  addBtn: {
    backgroundColor: Colors.neonCyan,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  addBtnText: {
    color: Colors.bgDeep,
    fontWeight: '700',
    letterSpacing: 1,
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
  modalBtnRemove: {
    backgroundColor: Colors.critical,
    borderRadius: 8,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  modalBtnRemoveText: {
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

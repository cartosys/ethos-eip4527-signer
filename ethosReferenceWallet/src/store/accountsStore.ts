import * as Keychain from 'react-native-keychain';
import { ethers } from 'ethers';

export interface Account {
  id: string;
  nickname: string;
  address: string;
}

const INDEX_SERVICE = 'ethos.accounts.index';
const SEED_FLAG_SERVICE = 'ethos.accounts.seeded';
const keyService = (id: string) => `ethos.accounts.key.${id}`;

// Anvil/Hardhat account #0, derived from the well-known insecure test mnemonic
// "test test test test test test test test test test test junk" — same key
// already used as the dev fallback in localSigner.ts. Never use this on mainnet.
const DEMO_NICKNAME = 'Demo Wallet';
const DEMO_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function normalizePrivateKey(input: string): string {
  const trimmed = input.trim();
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw { code: 'INVALID_PRIVATE_KEY', message: 'Private key must be 64 hex characters.', recoverable: true };
  }
  return hex;
}

function deriveAddress(privateKeyHex: string): string {
  try {
    return new ethers.Wallet(privateKeyHex).address;
  } catch (e) {
    throw { code: 'INVALID_PRIVATE_KEY', message: e instanceof Error ? e.message : 'Invalid private key', recoverable: true };
  }
}

async function readIndex(): Promise<Account[]> {
  const creds = await Keychain.getGenericPassword({ service: INDEX_SERVICE });
  if (!creds) return [];
  try {
    return JSON.parse(creds.password) as Account[];
  } catch {
    return [];
  }
}

async function writeIndex(accounts: readonly Account[]): Promise<void> {
  await Keychain.setGenericPassword(INDEX_SERVICE, JSON.stringify(accounts), { service: INDEX_SERVICE });
}

export async function listAccounts(): Promise<Account[]> {
  return readIndex();
}

export async function findAccountByAddress(address: string): Promise<Account | null> {
  const target = address.toLowerCase();
  const accounts = await readIndex();
  return accounts.find(a => a.address.toLowerCase() === target) ?? null;
}

// Pulls the raw private key into memory only at the point of use (signing) —
// callers should not hold onto the result longer than the signing call itself.
export async function getPrivateKeyForAccountId(id: string): Promise<string | null> {
  const creds = await Keychain.getGenericPassword({ service: keyService(id) });
  return creds ? creds.password : null;
}

export async function addAccount(nickname: string, privateKeyInput: string): Promise<Account> {
  const trimmedNickname = nickname.trim();
  if (!trimmedNickname) {
    throw { code: 'INVALID_NICKNAME', message: 'Nickname cannot be empty.', recoverable: true };
  }
  const privateKeyHex = normalizePrivateKey(privateKeyInput);
  const address = deriveAddress(privateKeyHex);

  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await Keychain.setGenericPassword(id, privateKeyHex, { service: keyService(id) });

  const account: Account = { id, nickname: trimmedNickname, address };
  const accounts = await readIndex();
  await writeIndex([...accounts, account]);
  return account;
}

export async function updateAccount(
  id: string,
  changes: { nickname?: string; privateKeyInput?: string }
): Promise<Account> {
  const accounts = await readIndex();
  const existing = accounts.find(a => a.id === id);
  if (!existing) {
    throw { code: 'ACCOUNT_NOT_FOUND', message: 'Account no longer exists.', recoverable: true };
  }

  let nickname = existing.nickname;
  if (changes.nickname !== undefined) {
    const trimmed = changes.nickname.trim();
    if (!trimmed) {
      throw { code: 'INVALID_NICKNAME', message: 'Nickname cannot be empty.', recoverable: true };
    }
    nickname = trimmed;
  }

  let address = existing.address;
  if (changes.privateKeyInput !== undefined && changes.privateKeyInput.trim() !== '') {
    const privateKeyHex = normalizePrivateKey(changes.privateKeyInput);
    address = deriveAddress(privateKeyHex);
    await Keychain.setGenericPassword(id, privateKeyHex, { service: keyService(id) });
  }

  const updated: Account = { id, nickname, address };
  await writeIndex(accounts.map(a => (a.id === id ? updated : a)));
  return updated;
}

export async function removeAccount(id: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: keyService(id) });
  const accounts = await readIndex();
  await writeIndex(accounts.filter(a => a.id !== id));
}

// Seeds the well-known Anvil/Hardhat demo account exactly once per install.
// The seed flag (not just an empty list) tracks whether seeding already ran,
// so a user who deletes "Demo Wallet" doesn't have it silently reappear.
export async function seedDefaultAccountIfNeeded(): Promise<void> {
  const flag = await Keychain.getGenericPassword({ service: SEED_FLAG_SERVICE });
  if (flag) return;
  await Keychain.setGenericPassword(SEED_FLAG_SERVICE, '1', { service: SEED_FLAG_SERVICE });
  try {
    await addAccount(DEMO_NICKNAME, DEMO_PRIVATE_KEY);
  } catch (e) {
    if (__DEV__) console.warn('[accountsStore] failed to seed demo account', e);
  }
}

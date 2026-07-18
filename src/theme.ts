import { Platform } from 'react-native';

export const Colors = {
  bgDeep:       '#0A0A1A',
  bgCard:       '#12122A',
  bgElevated:   '#1A1A38',
  neonCyan:     '#00F5FF',
  neonMagenta:  '#FF00FF',
  neonPurple:   '#9D00FF',
  neonGreen:    '#00FF9D',
  critical:     '#FF2D55',
  high:         '#FF6B00',
  medium:       '#FFD600',
  low:          '#8E8EA0',
  textPrimary:  '#F0F0FF',
  textSecondary:'#8080B0',
  textMono:     '#00F5FF',
  borderGlow:   '#3D3D7A',
  glowCyan:     'rgba(0, 245, 255, 0.15)',
  glowMagenta:  'rgba(255, 0, 255, 0.15)',
} as const;

export const FontFamily = {
  mono: Platform.select({ android: 'monospace', ios: 'Courier New' }) ?? 'monospace',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const ChainColors: Record<string, string> = {
  ethereum: '#627EEA',
  arbitrum: '#28A0F0',
  optimism: '#FF0420',
  base:     '#0052FF',
  polygon:  '#8247E5',
  solana:   '#9945FF',
};

export const SeverityColors: Record<string, string> = {
  critical: Colors.critical,
  high:     Colors.high,
  medium:   Colors.medium,
  low:      Colors.low,
};

export function formatEth(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    const wholePart = wei / BigInt('1000000000000000000');
    const remainder = wei % BigInt('1000000000000000000');
    const fracStr = remainder.toString().padStart(18, '0').slice(0, 6);
    return `${wholePart}.${fracStr} ETH`;
  } catch {
    return `${weiStr} wei`;
  }
}

export function formatGwei(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    const gwei = wei / BigInt('1000000000');
    const rem = (wei % BigInt('1000000000')) / BigInt('1000000');
    return `${gwei}.${rem.toString().padStart(3, '0')} Gwei`;
  } catch {
    return `${weiStr} wei`;
  }
}

export function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

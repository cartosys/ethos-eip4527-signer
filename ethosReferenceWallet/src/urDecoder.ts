import { URDecoder } from '@ngraveio/bc-ur';
import { decode as cborDecode } from 'cbor-x';

export interface ParsedSignRequest {
  requestId: Uint8Array;
  signData: Uint8Array;
  chainId: number;
  origin?: string;
  dataType: number;
}

export function newUrDecoder(): URDecoder {
  return new URDecoder();
}

export function decodeUrFragment(decoder: URDecoder, fragment: string): boolean {
  try {
    return decoder.receivePart(fragment);
  } catch {
    return false;
  }
}

export function assembleSignRequest(decoder: URDecoder): ParsedSignRequest {
  if (!decoder.isComplete()) {
    throw { code: 'UR_INCOMPLETE', message: 'UR assembly not complete', recoverable: true };
  }

  let cbor: Uint8Array;
  try {
    const ur = decoder.resultUR();
    cbor = ur.cbor as unknown as Uint8Array;
  } catch {
    throw { code: 'UR_INVALID', message: 'Failed to extract UR result', recoverable: false };
  }

  let decoded: unknown;
  try {
    decoded = cborDecode(cbor);
  } catch {
    throw { code: 'UR_INVALID', message: 'Failed to decode CBOR payload', recoverable: false };
  }

  const get = (key: number): unknown => {
    if (decoded instanceof Map) return decoded.get(key);
    if (typeof decoded === 'object' && decoded !== null) {
      return (decoded as Record<string, unknown>)[String(key)];
    }
    return undefined;
  };

  const rawSignData = get(2);
  if (rawSignData == null) {
    throw { code: 'UR_INVALID', message: 'Missing signData field (key 2)', recoverable: false };
  }

  const signData = new Uint8Array(rawSignData as ArrayBuffer);

  if (signData[0] !== 0x02) {
    throw {
      code: 'INVALID_TX_TYPE',
      message: `Expected EIP-1559 prefix 0x02, got 0x${signData[0]?.toString(16) ?? '??'}`,
      recoverable: false,
    };
  }

  const rawRequestId = get(1);
  const requestId = rawRequestId != null
    ? new Uint8Array(rawRequestId as ArrayBuffer)
    : new Uint8Array(0);

  return {
    requestId,
    signData,
    dataType:  (get(3) as number | undefined) ?? 1,
    chainId:   (get(4) as number | undefined) ?? 1,
    origin:    get(7) as string | undefined,
  };
}

export function toHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

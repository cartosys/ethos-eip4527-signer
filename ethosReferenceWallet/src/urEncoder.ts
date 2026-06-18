import { UR, UREncoder } from '@ngraveio/bc-ur';
import { encode as cborEncode } from 'cbor-x';

const EIP4527_KEY = {
  REQUEST_ID: 1,
  SIGNATURE: 2,
  ORIGIN: 7,
} as const;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Encodes the signed transaction as an EIP-4527 "eth-signature" UR, correlated
// to its originating request via requestId (key 1), so a scanning device can
// match the response to the eth-sign-request it issued.
export function encodeSignatureResponse(
  requestIdHex: string,
  signedTxHex: string,
  origin?: string,
): string {
  const cborMap = new Map<number, unknown>([
    [EIP4527_KEY.REQUEST_ID, Buffer.from(hexToBytes(requestIdHex))],
    [EIP4527_KEY.SIGNATURE, Buffer.from(hexToBytes(signedTxHex))],
  ]);
  if (origin) {
    cborMap.set(EIP4527_KEY.ORIGIN, origin);
  }

  const cbor = new Uint8Array(cborEncode(cborMap));
  const ur = new UR(Buffer.from(cbor), 'eth-signature');
  return UREncoder.encodeSinglePart(ur).toUpperCase();
}

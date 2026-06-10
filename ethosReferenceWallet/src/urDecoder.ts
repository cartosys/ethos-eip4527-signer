import { URDecoder } from '@ngraveio/bc-ur';
import bytewords from '@ngraveio/bc-ur/dist/bytewords';
import { FountainEncoderPart } from '@ngraveio/bc-ur/dist/fountainEncoder';
import { crc32 } from 'crc';
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

export function decodeUrFragment(
  decoder: URDecoder,
  fragment: string,
): { ok: boolean; error?: string } {
  try {
    const ok = decoder.receivePart(fragment);
    return { ok };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (__DEV__) console.warn('[urDecoder] receivePart threw:', msg, e);
    return { ok: false, error: msg };
  }
}

// ── Manual multi-part assembler ───────────────────────────────────────────────
// Handles wallets that omit zero-padding on the last fragment.  The standard
// @ngraveio/bc-ur URDecoder requires all fragments to have equal byte length;
// this assembler skips that check and reconstructs by concat+slice.

interface RawPart {
  seqNum:   number;
  seqLen:   number;
  msgLen:   number;
  checksum: number;
  fragment: Buffer;
}

function extractRawPart(fragment: string): RawPart | null {
  try {
    const [, components] = URDecoder.parse(fragment);
    if (components.length !== 2) return null;
    const [seq, payload] = components;
    const [urlSeqNum, urlSeqLen] = URDecoder.parseSequenceComponent(seq);
    const cbor = bytewords.decode(payload, bytewords.STYLES.MINIMAL);
    const part = FountainEncoderPart.fromCBOR(cbor);
    if (urlSeqNum !== part.seqNum || urlSeqLen !== part.seqLength) return null;
    return {
      seqNum:   part.seqNum,
      seqLen:   part.seqLength,
      msgLen:   part.messageLength,
      checksum: part.checksum,
      fragment: Buffer.from(part.fragment),
    };
  } catch {
    return null;
  }
}

export class MultipartUrDecoder {
  private parts  = new Map<number, RawPart>();
  private seqLen: number | null = null;
  private msgLen: number | null = null;
  private checksum: number | null = null;

  receivePart(fragment: string): boolean {
    const raw = extractRawPart(fragment);
    if (!raw) return false;

    // Only accept pure (non-fountain-mixed) parts: seqNum ≤ seqLen
    if (raw.seqNum > raw.seqLen) return false;

    if (this.seqLen === null) {
      this.seqLen   = raw.seqLen;
      this.msgLen   = raw.msgLen;
      this.checksum = raw.checksum;
    } else if (
      this.seqLen   !== raw.seqLen  ||
      this.msgLen   !== raw.msgLen  ||
      this.checksum !== raw.checksum
    ) {
      return false;
    }

    if (this.parts.has(raw.seqNum)) return false; // already have it
    this.parts.set(raw.seqNum, raw);
    return true;
  }

  isComplete(): boolean {
    return this.seqLen !== null && this.parts.size === this.seqLen;
  }

  // Returns the assembled message bytes, or null if CRC fails.
  assemble(): Buffer | null {
    if (!this.isComplete()) return null;
    const ordered = Array.from({ length: this.seqLen! }, (_, i) => this.parts.get(i + 1)!.fragment);
    const message = Buffer.concat(ordered).subarray(0, this.msgLen!);
    if (crc32(message) !== this.checksum!) return null;
    return message;
  }

  get receivedCount(): number { return this.parts.size; }
  get totalCount():    number { return this.seqLen ?? 0; }
}

// ─────────────────────────────────────────────────────────────────────────────

function parseCborMessage(cbor: Uint8Array): ParsedSignRequest {
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
  const rawRequestId = get(1);
  const requestId = rawRequestId != null
    ? new Uint8Array(rawRequestId as ArrayBuffer)
    : new Uint8Array(0);

  return {
    requestId,
    signData,
    dataType: (get(3) as number | undefined) ?? 1,
    chainId:  (get(4) as number | undefined) ?? 1,
    origin:   get(7) as string | undefined,
  };
}

export function assembleSignRequest(decoder: URDecoder): ParsedSignRequest {
  if (!decoder.isComplete()) {
    throw { code: 'UR_INCOMPLETE', message: 'UR assembly not complete', recoverable: true };
  }

  let cbor: Uint8Array;
  try {
    const ur = decoder.resultUR();
    // Copy into a fresh native Uint8Array so cbor-x's DataView constructor
    // always receives a proper ArrayBuffer (Buffer polyfill instances can have
    // offsets or missing .buffer getters that confuse DataView in Hermes).
    cbor = Uint8Array.from(ur.cbor as unknown as ArrayLike<number>);
  } catch {
    throw { code: 'UR_INVALID', message: 'Failed to extract UR result', recoverable: false };
  }

  return parseCborMessage(cbor);
}

export function assembleSignRequestFromBuffer(message: Buffer): ParsedSignRequest {
  // Copy to a native Uint8Array for the same reason as above.
  const cbor = Uint8Array.from(message);
  return parseCborMessage(cbor);
}

export function toHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface FragmentDiag {
  urlSeqNum:  number;
  urlSeqLen:  number;
  cborSeqNum: number;
  cborSeqLen: number;
  cborMsgLen: number;
  fragByteLen: number;
  error?: string;
}

export function diagFragment(fragment: string): FragmentDiag | null {
  try {
    const [, components] = URDecoder.parse(fragment);
    if (components.length !== 2) return null;
    const [seq, payload] = components;
    const [urlSeqNum, urlSeqLen] = URDecoder.parseSequenceComponent(seq);
    const cbor = bytewords.decode(payload, bytewords.STYLES.MINIMAL);
    const part = FountainEncoderPart.fromCBOR(cbor);
    return {
      urlSeqNum,
      urlSeqLen,
      cborSeqNum:  part.seqNum,
      cborSeqLen:  part.seqLength,
      cborMsgLen:  part.messageLength,
      fragByteLen: part.fragment.length,
    };
  } catch (e) {
    return { urlSeqNum: -1, urlSeqLen: -1, cborSeqNum: -1, cborSeqLen: -1, cborMsgLen: -1, fragByteLen: -1, error: String(e) };
  }
}

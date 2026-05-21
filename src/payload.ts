export interface PayloadMetadata {
  [key: string]: unknown;
}

export interface DecodedPayload {
  protocol: "eip4527" | "eip681" | "raw";

  raw: Uint8Array;

  decoded: unknown;

  fragments?: number;

  metadata?: PayloadMetadata;
}
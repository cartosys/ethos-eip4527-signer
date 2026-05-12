export interface SignerRequest {
  transaction: TransactionEnvelope;

  actions?: HumanReadableAction[];

  warnings?: SecurityWarning[];
}

export interface SignerResponse {
  signedTx: string;

  signerAddress: string;

  signatureType: "transaction" | "message";
}
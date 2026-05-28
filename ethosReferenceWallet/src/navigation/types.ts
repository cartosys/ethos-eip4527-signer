export type RootStackParamList = {
  Scanner: { initialFragment?: string };
  TxReview: {
    envelopeJson: string;
    signDataHex:  string;
    requestIdHex: string;
    origin?:      string;
  };
  SigningResult: {
    signedTx:      string;
    signerAddress: string;
    elapsedMs:     number;
  };
  Simulator: undefined;
};

export type RootStackParamList = {
  Scanner: undefined;
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
};

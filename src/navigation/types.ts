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
    requestIdHex:  string;
    origin?:       string;
  };
  Simulator: undefined;
  Accounts: undefined;
  AccountForm: { accountId?: string };
};

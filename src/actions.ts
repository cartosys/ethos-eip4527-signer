export interface HumanReadableAction {
  type: ActionType;

  summary: string;

  warnings?: string[];

  confidence?: number;
}

export type ActionType =
  | "transfer"
  | "approve"
  | "swap"
  | "contract-call"
  | "signature"
  | "unknown";

export interface TransferAction
  extends HumanReadableAction {

  type: "transfer";

  assetSymbol: string;

  amount: string;

  recipient: string;
}

export interface ApproveAction
  extends HumanReadableAction {

  type: "approve";

  token: string;

  spender: string;

  amount: string;
}

export interface SecurityWarning {
  severity: "low" | "medium" | "high" | "critical";

  code: string;

  message: string;
}
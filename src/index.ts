export * from "./transaction";
export * from "./actions";
export * from "./payload";
export * from "./signer";
export * from "./chains";
export * from "./errors";

import { z } from "zod";

export const TransactionEnvelopeSchema = z.object({
  chain: z.string(),
  to: z.string().optional(),
  value: z.string().optional()
});
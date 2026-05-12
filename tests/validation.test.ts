import { describe, it, expect } from "vitest";
import { TransactionEnvelopeSchema } from "../src/index";
import type { TransactionEnvelope, TransactionMetadata } from "../src/transaction";

describe("TransactionEnvelope", () => {
  it("supports eip1559 txs", () => {
    const tx: TransactionEnvelope = {
      chain: "ethereum",
      from: "0xabc123",
      to: "0xdef456",
      value: "1000000000000000000",
      nonce: 42,
      gasLimit: "21000",
      maxFeePerGas: "30000000000",
      maxPriorityFeePerGas: "1000000000",
      chainId: 1,
      type: "eip1559",
    };

    expect(tx.type).toBe("eip1559");
    expect(tx.maxFeePerGas).toBeDefined();
    expect(tx.maxPriorityFeePerGas).toBeDefined();
  });

  describe("serialization", () => {
    it("round-trips through JSON without data loss", () => {
      const tx: TransactionEnvelope = {
        chain: "base",
        to: "0xrecipient",
        value: "500000000000000000",
        type: "eip1559",
        chainId: 8453,
        metadata: {
          origin: "https://app.example.com",
          timestamp: 1715000000,
          notes: ["user confirmed"],
        },
      };

      const serialized = JSON.stringify(tx);
      const parsed = JSON.parse(serialized) as TransactionEnvelope;

      expect(parsed.chain).toBe(tx.chain);
      expect(parsed.value).toBe(tx.value);
      expect(parsed.chainId).toBe(tx.chainId);
      expect(parsed.metadata?.origin).toBe(tx.metadata?.origin);
      expect(parsed.metadata?.notes).toEqual(tx.metadata?.notes);
    });

    it("serializes a minimal tx with only the required chain field", () => {
      const tx: TransactionEnvelope = { chain: "ethereum" };
      const serialized = JSON.stringify(tx);
      const parsed = JSON.parse(serialized) as TransactionEnvelope;

      expect(parsed.chain).toBe("ethereum");
      expect(parsed.to).toBeUndefined();
      expect(parsed.value).toBeUndefined();
    });
  });

  describe("parsing assumptions (Zod schema)", () => {
    it("accepts a valid envelope with required chain", () => {
      const result = TransactionEnvelopeSchema.safeParse({ chain: "ethereum" });
      expect(result.success).toBe(true);
    });

    it("accepts a full valid envelope", () => {
      const result = TransactionEnvelopeSchema.safeParse({
        chain: "polygon",
        to: "0xrecipient",
        value: "1000",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.chain).toBe("polygon");
        expect(result.data.to).toBe("0xrecipient");
      }
    });

    it("rejects when chain is missing", () => {
      const result = TransactionEnvelopeSchema.safeParse({
        to: "0xrecipient",
        value: "1000",
      });
      expect(result.success).toBe(false);
    });

    it("rejects when chain is not a string", () => {
      const result = TransactionEnvelopeSchema.safeParse({ chain: 1 });
      expect(result.success).toBe(false);
    });
  });

  describe("optional fields", () => {
    it("allows all optional fields to be omitted", () => {
      const tx: TransactionEnvelope = { chain: "optimism" };
      expect(tx.to).toBeUndefined();
      expect(tx.value).toBeUndefined();
      expect(tx.nonce).toBeUndefined();
      expect(tx.gasLimit).toBeUndefined();
      expect(tx.data).toBeUndefined();
      expect(tx.type).toBeUndefined();
      expect(tx.metadata).toBeUndefined();
    });

    it("accepts partial optional fields", () => {
      const tx: TransactionEnvelope = {
        chain: "arbitrum",
        nonce: 0,
        data: "0xdeadbeef",
      };
      expect(tx.nonce).toBe(0);
      expect(tx.data).toBe("0xdeadbeef");
      expect(tx.to).toBeUndefined();
    });

    it("accepts metadata with only some fields set", () => {
      const meta: TransactionMetadata = { origin: "https://dapp.example.com" };
      const tx: TransactionEnvelope = { chain: "ethereum", metadata: meta };
      expect(tx.metadata?.origin).toBe("https://dapp.example.com");
      expect(tx.metadata?.timestamp).toBeUndefined();
      expect(tx.metadata?.notes).toBeUndefined();
    });

    it("schema treats to and value as optional", () => {
      const withoutTo = TransactionEnvelopeSchema.safeParse({ chain: "base", value: "100" });
      const withoutValue = TransactionEnvelopeSchema.safeParse({ chain: "base", to: "0xaddr" });
      const withNeither = TransactionEnvelopeSchema.safeParse({ chain: "base" });

      expect(withoutTo.success).toBe(true);
      expect(withoutValue.success).toBe(true);
      expect(withNeither.success).toBe(true);
    });
  });

  describe("invalid structures", () => {
    it("rejects null input", () => {
      const result = TransactionEnvelopeSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it("rejects an empty object", () => {
      const result = TransactionEnvelopeSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects an array instead of object", () => {
      const result = TransactionEnvelopeSchema.safeParse(["ethereum"]);
      expect(result.success).toBe(false);
    });

    it("rejects when chain is a number", () => {
      const result = TransactionEnvelopeSchema.safeParse({ chain: 1337 });
      expect(result.success).toBe(false);
    });

    it("rejects when to is not a string", () => {
      const result = TransactionEnvelopeSchema.safeParse({ chain: "ethereum", to: 12345 });
      expect(result.success).toBe(false);
    });

    it("rejects when value is not a string", () => {
      const result = TransactionEnvelopeSchema.safeParse({ chain: "ethereum", value: 9999 });
      expect(result.success).toBe(false);
    });
  });
});

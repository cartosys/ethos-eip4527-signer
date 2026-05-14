# The open-source EVM transaction interpreter and signer for ethOS
# dGEN1 Airgap

Open infrastructure for transparent air-gapped transaction signing.

`dGEN1 Airgap` is an open-source transaction inspection and signing pipeline designed for QR-based crypto workflows, offline wallets, and hardware signing devices.

The project focuses on one core problem:

> Helping humans safely understand what they are about to sign.

---

# Vision

Modern crypto signing UX is still dangerously opaque.

Users routinely sign:
- unreadable calldata
- malicious approvals
- phishing payloads
- blind swaps
- unsafe contract interactions

dGEN1 Airgap aims to provide a modular, auditable, and transport-agnostic architecture for:

- QR transaction transport
- UR/CBOR decoding
- transaction normalization
- human-readable inspection
- secure offline signing

The system is intentionally designed to work in:
- air-gapped environments
- hardware wallet ecosystems
- mobile signing flows
- offline-first security models

---

# Project Goals

## V1 Goals

The first version of the project focuses on executable examples proving the complete signing pipeline:

```text
QR
→ Decode
→ Parse
→ Normalize
→ Inspect
→ Sign
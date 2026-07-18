# CLAUDE.md — ethosReferenceWallet

**Stack:** React Native 0.85 (Android + iOS), TypeScript strict, React Navigation, Jest, pnpm.
**Domain:** EIP-4527 air-gapped transaction signer. Scans an animated QR from a watch-only wallet, decodes it, shows a human-readable transaction review, signs locally, and displays a signed-tx QR. Security-critical — bugs here can cause irreversible asset loss.

---

## Behavioral Rules

**Think before coding.** State assumptions explicitly. Ask rather than guess. Push back when a simpler path exists.

**Plan Mode required for tasks with 3+ steps.** Enter Plan Mode, get approval, then execute. Do not implement and plan simultaneously.

**Read before you write.** Before modifying a screen or utility, read its callers and the shared modules it depends on (`urDecoder.ts`, `urEncoder.ts`, `localSigner.ts`, `accountsStore.ts`, `theme.ts`).

**Surgical changes only.** Touch only what the task requires. Do not improve adjacent code, rename variables, or refactor unless explicitly asked.

**Surface conflicts, don't average them.** If two existing patterns contradict, pick the more recent or more tested one, explain the choice, and flag the other for cleanup.

**Checkpoint after every significant step.** State: what was done, what is verified, what remains. Do not continue from a state you cannot describe back.

**Fail loud.** "Done" is wrong if anything was skipped silently. "Tests pass" is wrong if any were skipped or commented out. Surface uncertainty — do not hide it.

---

## Coding Standards

**TypeScript strict mode is non-negotiable.** Never use `any`, `@ts-ignore`, or unsafe casts without an explicit comment explaining why. No `as unknown as T` escape hatches.

**Ethereum values are strings, not numbers.** `value`, `gasLimit`, `maxFeePerGas`, etc. are `string` (big-number hex/decimal), matching `ethers` conventions. Never coerce them to `number` — precision loss causes fund loss.

**No implicit mutation.** Prefer `readonly` properties and `as const` on literals. Never mutate a parameter — return a new value.

**Key material stays out of logs.** Never `console.log` a private key, mnemonic, or signed payload. `localSigner.ts` and `accountsStore.ts` (Keychain-backed) are the only places private keys should be read into memory.

**Dev-only bypasses must be gated and obvious.** `src/dev/testScenarios.ts` and the emulator PASTE UR/JSON bypass exist for camera-less testing only — never let dev-mode paths run unguarded in a release build.

**Module boundaries:**
- `src/urDecoder.ts` / `src/urEncoder.ts` — bc-ur/CBOR transport encoding, no UI concerns.
- `src/localSigner.ts` — signing only; no navigation or display logic.
- `src/store/accountsStore.ts` — Keychain-backed account persistence.
- `src/screens/*` — UI + orchestration; call into the above, don't duplicate their logic.
- `src/components/*` — presentational only, no direct signing/storage access.

---

## Testing Standards

**Run tests before marking any task complete:**
```bash
pnpm test
```

**Tests encode WHY, not just WHAT.** A test that can't fail when business logic changes is wrong.

**Do not skip or comment out tests to make CI green.** If a test must be removed, explain in the commit why, and what invariant is now enforced elsewhere.

**Security-path tests are mandatory.** Any code that touches signing, key material, or QR/UR decoding must have a test (or a Simulator scenario in `src/dev/testScenarios.ts`) for the rejection/failure case, not just the happy path.

---

## Project Structure

```
src/
  screens/          # Scanner -> TxReview -> SigningResult, plus Accounts + Simulator
  components/        # Presentational pieces (badges, warnings, error views)
  navigation/         # React Navigation stack + route types
  store/              # accountsStore.ts — Keychain-backed account management
  dev/                # testScenarios.ts — Simulator fixtures for camera-less testing
  urDecoder.ts        # bc-ur / CBOR fragment decoding
  urEncoder.ts        # bc-ur / CBOR encoding for the signed-tx QR
  localSigner.ts      # ethers.js signing
  theme.ts            # Colors, spacing, formatting helpers
android/              # Native Android project
ios/                  # Native iOS project
scripts/              # dev.sh (Metro + emulator), emulator-webcam.sh
__tests__/            # Jest tests
```

See `README.md` for the full signing pipeline architecture and the Dev Simulator's 5 test scenarios.

---

## Verification Checklist

Before reporting any task complete, run these in order:

```bash
pnpm test              # Jest tests must pass
npx tsc --noEmit       # Zero type errors
pnpm lint              # Zero lint errors (eslint)
```

For UI/flow changes, also run the app (`pnpm dev` or the Dev Simulator) and exercise the affected screen — passing tests do not confirm the feature works end-to-end.

If any command fails, fix it — do not report completion with known failures outstanding.

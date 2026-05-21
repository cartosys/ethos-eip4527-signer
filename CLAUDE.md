# CLAUDE.md — ethos-eip4527-signer

**Stack:** TypeScript 6 (strict), Zod 4, Vitest 4, pnpm + Turborepo monorepo.
**Domain:** EIP-4527 transaction signing — security-critical. Bugs here can cause irreversible asset loss.

---

## Behavioral Rules

**Think before coding.** State assumptions explicitly. Ask rather than guess. Push back when a simpler path exists.

**Plan Mode required for tasks with 3+ steps.** Enter Plan Mode, get approval, then execute. Do not implement and plan simultaneously.

**Use @@file references to anchor context.** When editing a module, reference its file explicitly (e.g., `@@src/signer.ts`) so context stays grounded in actual code, not memory.

**Read before you write.** Before modifying any file, read its exports, immediate callers, and any shared utilities it depends on. Check `src/index.ts` before touching any public API.

**Surgical changes only.** Touch only what the task requires. Do not improve adjacent code, rename variables, or refactor unless explicitly asked.

**Surface conflicts, don't average them.** If two existing patterns contradict, pick the more recent or more tested one, explain the choice, and flag the other for cleanup.

**Checkpoint after every significant step.** State: what was done, what is verified, what remains. Do not continue from a state you cannot describe back.

**Fail loud.** "Done" is wrong if anything was skipped silently. "Tests pass" is wrong if any were skipped or commented out. Surface uncertainty — do not hide it.

**Token budgets are not advisory.** Per-task: 4,000 tokens. Per-session: 30,000 tokens. Approaching the limit? Summarize and start fresh. Surface the breach.

---

## Coding Standards

**TypeScript strict mode is non-negotiable.** `tsconfig.json` has `"strict": true`. Never use `any`, `@ts-ignore`, or unsafe casts without an explicit comment explaining why. No `as unknown as T` escape hatches.

**Zod is the validation boundary.** All external/untrusted input (user data, network payloads, deserialized JSON) must pass through a Zod schema before use. Do not hand-write validation logic that duplicates what Zod can enforce.

**No implicit mutation.** Prefer `readonly` properties and `as const` on literals. Never mutate a parameter — return a new value.

**Ethereum values are strings, not numbers.** `value`, `gasLimit`, `maxFeePerGas`, etc. are `string` (big-number hex/decimal). Never coerce them to `number` — precision loss causes fund loss.

**Errors are typed.** Use `DgenError` (see `src/errors.ts`) for all thrown/returned errors. `recoverable: boolean` must be set correctly — a recoverable flag on an unrecoverable signing failure is a security bug.

**No `console.log` in library code.** This is a library (`src/`). Side effects in production bundles are forbidden. Use structured error returns or typed throws only.

**Module boundaries matter.** `src/index.ts` is the public API. Do not import from internal modules in tests or examples — import from `../src/index`. Adding a new export to `index.ts` is a public API change; call that out explicitly.

**Immutable exports only.** Do not export mutable state (e.g., a plain `let` or an object that callers can mutate). Export functions and `readonly` types.

---

## Testing Standards

**Run tests before marking any task complete:**
```
pnpm test
```

**Tests encode WHY, not just WHAT.** A test that can't fail when business logic changes is wrong. The EIP-4527 test for `rejects when chain is missing` exists because a missing chain means an unroutable transaction — say that in the test name or a comment.

**Do not skip or comment out tests to make CI green.** If a test must be removed, explain in the commit why, and what invariant is now enforced elsewhere.

**Security-path tests are mandatory.** Any code that touches signing, key material, or chain routing must have a test for the rejection/failure case, not just the happy path.

---

## Project Structure

```
src/              # Library source — public API exported via index.ts
  actions.ts      # HumanReadableAction types
  chains.ts       # Supported chain definitions
  errors.ts       # DgenError interface
  payload.ts      # EIP-4527 payload types
  signer.ts       # SignerRequest / SignerResponse interfaces
  transaction.ts  # TransactionEnvelope and TransactionMetadata
  index.ts        # Public API barrel — only export what is intentional
tests/            # Vitest tests — mirror src/ structure
packages/         # Internal shared packages (monorepo)
  shared-types/   # Cross-package types
examples/         # Usage examples — not part of the library bundle
apps/             # Application layer (future)
```

**Before adding a new file to `src/`:** confirm it cannot live in an existing file. Prefer extending over proliferating modules.

---

## Verification Checklist

Before reporting any task complete, run these in order:

```bash
pnpm test              # All tests must pass
npx tsc --noEmit       # Zero type errors
npx eslint src tests   # Zero lint errors
```

If any command fails, fix it — do not report completion with known failures outstanding.

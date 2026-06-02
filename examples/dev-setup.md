# Dev Account Setup (Sepolia Testnet)

## 1. Generate a throwaway key

Using `cast` (Foundry):
```bash
cast wallet new
```

Using `tsx` (no extra install needed):
```bash
tsx -e "import { ethers } from 'ethers'; const w = ethers.Wallet.createRandom(); console.log('Private key:', w.privateKey); console.log('Address:', w.address);"
```

## 2. Set the key in `.env`

```bash
cp .env.example .env
# Edit .env and replace the placeholder with your private key
```

## 3. Check your balance

```bash
pnpm check-dev-balance
```

If balance is zero, the script prints faucet links. Fund the address, then re-run.

---

> **Warning:** This key is for Sepolia testnet only. Never reuse it on mainnet. Never commit `.env`.

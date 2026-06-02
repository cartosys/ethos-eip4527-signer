import { ethers } from 'ethers';
import { loadDevAccount } from '../src/dev/devAccount';

async function main() {
  const account = loadDevAccount();
  const rpcUrl = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const balance = await provider.getBalance(account.address);

  console.log(`Address : ${account.address}`);
  console.log(`Balance : ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.log('\nBalance is zero. Fund at:');
    console.log('  https://sepoliafaucet.com');
    console.log('  https://faucet.quicknode.com/ethereum/sepolia');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err instanceof Object && 'message' in err ? err.message : err);
  process.exit(1);
});

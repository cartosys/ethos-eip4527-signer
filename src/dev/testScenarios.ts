export type ScenarioKind =
  | { type: 'ur'; fragment: string }
  | { type: 'envelope'; json: string; signDataHex: string; requestIdHex: string; origin?: string };

export interface TestScenario {
  id: string;
  label: string;
  description: string;
  badge: 'green' | 'yellow' | 'red';
  scenario: ScenarioKind;
}

// UR strings sourced from monorepo fixtures/ — see fixtures/*.json for full context.
const ETH_TRANSFER_UR =
  'ur:eth-sign-request/onadtpdagdfdfdfdfdfdfdfdfdfdfdfdfdfdfdfdtpcxhdcxvszmlfqdldlpvdhdcxgwbtvagofgsaaeaeaeaeaeaeaeadcsimlyadzcspbkdijkjyjlksjnkkjyjlkpktjkaoaefdfgfefpfefgfpfefgfpfefgfpfefgfpfefgfpfefg';

const ERC20_TRANSFER_UR =
  'ur:eth-sign-request/taadaxonadgdaofgletobwhgnduraoaofgletobwhgnduraohdjoaoyajnadaxlrhkisdlaelpamztcnpsaelfzcvsmwnbroinmeswclluensettntgedmnnpftoenamwmfdlarofyptahnsrkaeaeaeaeaeaeaeaeaeaeaeaejydpecsfiyeertgudtdaotrofyrffeglfyetwkglaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeahykvyaertaxadaaadatjyihjyisjljkdpihinjoeeeceyemdpjkiniojtihjplkdwmkba';

const UNISWAP_SWAP_UR =
  'ur:eth-sign-request/taadaxonadgdaaletobwhgnduraoaaletobwhgnduraoaohkadfraoytademadatlrhkisdlaelpamztcnpsaelsaxeegdmwvwmofwknbkwpwldpvlwewyctcsvtbzkeahlnbzieloamwthphktepraeaerhadaafpgrwfldaeaeaeaeaeaeaeaeaeaeaeaertdrpkesprcnzelgbkbahhgwdiwdtaayfnkpjzsaaeaeaeaeaeaeaeaeaeaeaeaenbroinmeswclluensettntgedmnnpftoenamwmfdaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeadwkaeaeaeaeaeaeaeaeaeaeaeaejydpecsfiyeertgudtdaotrofyrffeglfyetwkglaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaejeenwplaaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeamwthphktepraeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaehfjnfmlaaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaeaertaxadaaadatjyihjyisjljkdpihinjoeeeceyemdpjkiniojtihjpkolygaaa';

// signDataHex for direct-envelope scenarios is display-only (sliced to 14 chars in TxReview).
// The actual signing uses the envelope fields, not this value.
const FAKE_SIGN_DATA = '0x02' + 'ab'.repeat(20);

export const TEST_SCENARIOS: readonly TestScenario[] = [
  {
    id: 'eth-transfer',
    label: 'ETH Transfer',
    description: 'Single-fragment UR · EIP-1559 ETH transfer · transfer badge · no warnings',
    badge: 'green',
    scenario: { type: 'ur', fragment: ETH_TRANSFER_UR },
  },
  {
    id: 'erc20-transfer',
    label: 'ERC20 Transfer (USDC)',
    description: 'Single-fragment UR · USDC transfer(address,uint256) calldata · contract-call badge',
    badge: 'green',
    scenario: { type: 'ur', fragment: ERC20_TRANSFER_UR },
  },
  {
    id: 'uniswap-swap',
    label: 'Uniswap V3 Swap',
    description: 'Single-fragment UR · 0.5 ETH → USDC · exactInputSingle calldata · contract-call badge',
    badge: 'green',
    scenario: { type: 'ur', fragment: UNISWAP_SWAP_UR },
  },
  {
    id: 'zero-value-warning',
    label: 'Zero Value (Warning)',
    description: 'Direct to TxReview · zero ETH · no calldata → ZERO_VALUE medium warning',
    badge: 'yellow',
    scenario: {
      type: 'envelope',
      json: JSON.stringify({
        chain:                'ethereum',
        chainId:              1,
        type:                 'eip1559',
        to:                   '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        value:                '0',
        nonce:                0,
        gasLimit:             '21000',
        maxFeePerGas:         '10000000000',
        maxPriorityFeePerGas: '1000000000',
      }),
      signDataHex:  FAKE_SIGN_DATA,
      requestIdHex: '0x',
    },
  },
  {
    id: 'no-recipient-critical',
    label: 'No Recipient (Critical)',
    description: 'Direct to TxReview · missing to address → critical warning + confirmation modal',
    badge: 'red',
    scenario: {
      type: 'envelope',
      json: JSON.stringify({
        chain:                'ethereum',
        chainId:              1,
        type:                 'eip1559',
        value:                '1000000000000000000',
        nonce:                5,
        gasLimit:             '21000',
        maxFeePerGas:         '10000000000',
        maxPriorityFeePerGas: '1000000000',
      }),
      signDataHex:  FAKE_SIGN_DATA,
      requestIdHex: '0x',
    },
  },
];

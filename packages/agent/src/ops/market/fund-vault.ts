import { ReceiptStatusError, Status, TokenAssociateTransaction } from "@hiero-ledger/sdk";
import { setTimeout as sleep } from "node:timers/promises";
import { type Address, encodeFunctionData, erc20Abi, formatUnits, type Hex, isAddressEqual } from "viem";
import {
  chainTimestamp,
  type HederaPublicClient,
  type HederaWalletClient,
  readClient,
  sendContractCall,
  waitForReceipt,
  walletClient,
} from "../../chain";
import { type OperatorConfig, type ReadOnlyConfig } from "../../config";
import { hashscanUrl } from "../../hedera";
import { MirrorClient, MirrorNotFoundError, MirrorRequestError } from "../../mirror";
import { getNetwork, type TokenRef } from "../../networks";
import {
  encodePath,
  FEE_UNITS,
  getPoolState,
  hbarExactInputCalls,
  missingPoolDetail,
  poolPriceE18,
  type PoolQuote,
  quotePool,
} from "../../saucerswap";
import { swapRouterAbi, whbarAbi } from "../../saucerswap/abi";
import { hederaClient } from "../../hcs/client";

/** Over JSON-RPC a transaction's `value` is in weibars (18 decimals); the EVM and HTS count tinybars (8 decimals). */
const WEIBARS_PER_TINYBAR = 10n ** 10n;
export const HBAR_DECIMALS = 8;
/** Slippage allowed on the funding swap, against SaucerSwap's own quote taken just before sending. */
const SWAP_SLIPPAGE_BPS = 100n;
const SWAP_DEADLINE_SECONDS = 300;
/** How long to wait for the Mirror Node, which trails consensus by seconds, to show a new balance. */
const MIRROR_CATCH_UP_MS = 30_000;
const MIRROR_POLL_MS = 2_000;

type FundingRequest = {
  /** HBAR to wrap into WHBAR for the vault, in tinybars. */
  hbar?: bigint;
  /** Quote token (USDC) to buy with HBAR on SaucerSwap for the vault, in its smallest unit. */
  usdc?: bigint;
};

export type FundingStep =
  | { kind: "associate"; token: TokenRef }
  | { kind: "wrap"; tinybars: bigint }
  | { kind: "transfer"; token: TokenRef; amount: bigint }
  | { kind: "swap"; tinybars: bigint; quote: PoolQuote; minOut: bigint };

type SwapStep = Extract<FundingStep, { kind: "swap" }>;

type BalanceExpectation = { token: TokenRef; before: bigint; increase: bigint };

export type FundingPlan = {
  vault: Address;
  steps: FundingStep[];
  /** HBAR the steps spend, in tinybars, before network fees. */
  spendTinybars: bigint;
  /** Each funded token's vault balance before funding and the least it must grow by. */
  expectations: BalanceExpectation[];
};

type StepResult = { step: FundingStep; transactionId: string; url: string };

type BalanceCheck = BalanceExpectation & { after: bigint | null; confirmed: boolean };

/** What every funding transaction needs: who pays, where funds go, and the clients to read and sign with. */
type Context = {
  cfg: ReadOnlyConfig;
  operator: OperatorConfig;
  vault: Address;
  client: HederaPublicClient;
  wallet: HederaWalletClient;
  mirror: MirrorClient;
};

/**
 * Works out the funding transactions without sending any. Hedera rejects a token transfer to an account that is not
 * associated with the token, so the vault's associations are checked up front (only its owner can add them) and the
 * operator's association with WHBAR becomes a step when it is missing.
 */
export async function planFunding(
  cfg: ReadOnlyConfig,
  operator: OperatorConfig,
  request: FundingRequest,
): Promise<FundingPlan> {
  const vault = cfg.vaultAddress;
  if (!vault) throw new Error("no vault configured: set AUTONR_VAULT_ADDRESS");
  const { baseToken: whbar, quoteToken: usdc } = cfg;
  if (!isAddressEqual(whbar.address, getNetwork(cfg.network).baseToken.address)) {
    throw new Error(`funding wraps HBAR into WHBAR, but AUTONR_BASE_TOKEN makes ${whbar.symbol} the base token`);
  }
  const mirror = new MirrorClient({ baseUrl: cfg.mirrorUrl });
  await checkOperatorAccount(cfg, operator, mirror);

  const steps: FundingStep[] = [];
  const expectations: BalanceExpectation[] = [];
  if (request.hbar) {
    expectations.push({ token: whbar, before: await vaultBalance(cfg, mirror, vault, whbar), increase: request.hbar });
    if ((await mirror.tokenBalance(operator.accountId, whbar.id)) === null) {
      steps.push({ kind: "associate", token: whbar });
    }
    steps.push({ kind: "wrap", tinybars: request.hbar }, { kind: "transfer", token: whbar, amount: request.hbar });
  }
  if (request.usdc) {
    const before = await vaultBalance(cfg, mirror, vault, usdc);
    const swap = await planSwap(cfg, request.usdc);
    expectations.push({ token: usdc, before, increase: swap.minOut });
    steps.push(swap);
  }
  if (steps.length === 0) throw new Error("nothing to fund: ask for an amount of HBAR, USDC or both");

  const spendTinybars = steps.reduce(
    (total, step) => total + (step.kind === "wrap" || step.kind === "swap" ? step.tinybars : 0n),
    0n,
  );
  const holding = (await readClient(cfg).getBalance({ address: operator.address })) / WEIBARS_PER_TINYBAR;
  if (holding < spendTinybars) {
    throw new Error(
      `operator ${operator.accountId} holds ${formatHbar(holding)}, ` +
        `but funding spends ${formatHbar(spendTinybars)} plus fees`,
    );
  }
  return { vault, steps, spendTinybars, expectations };
}

/** Sends the plan's transactions in order and yields each once it has succeeded; the first failure throws. */
export async function* executeFunding(
  cfg: ReadOnlyConfig,
  operator: OperatorConfig,
  plan: FundingPlan,
): AsyncGenerator<StepResult> {
  const ctx: Context = {
    cfg,
    operator,
    vault: plan.vault,
    client: readClient(cfg),
    wallet: walletClient(cfg, operator.privateKey),
    mirror: new MirrorClient({ baseUrl: cfg.mirrorUrl }),
  };
  for (const step of plan.steps) {
    const transactionId = await runStep(ctx, step);
    yield { step, transactionId, url: hashscanUrl(cfg.network, "transaction", transactionId) };
  }
}

/** Re-reads the vault's balances from the Mirror Node, waiting for it to catch up with the funding transactions. */
export function confirmFunding(cfg: ReadOnlyConfig, plan: FundingPlan): Promise<BalanceCheck[]> {
  const mirror = new MirrorClient({ baseUrl: cfg.mirrorUrl });
  return Promise.all(
    plan.expectations.map(async expectation => {
      const target = expectation.before + expectation.increase;
      const after = await waitForTokenBalance(mirror, plan.vault, expectation.token.id, target);
      return { ...expectation, after, confirmed: after !== null && after >= target };
    }),
  );
}

export function formatHbar(tinybars: bigint): string {
  return `${formatUnits(tinybars, HBAR_DECIMALS)} HBAR`;
}

/**
 * JSON-RPC transactions belong to the account whose EVM address derives from the signing key, so the key must be the
 * operator account's own ECDSA key and the account must carry that EVM address.
 */
async function checkOperatorAccount(
  cfg: ReadOnlyConfig,
  operator: OperatorConfig,
  mirror: MirrorClient,
): Promise<void> {
  const account = await explainNotFound(
    mirror.account(operator.accountId),
    `OPERATOR_ACCOUNT_ID ${operator.accountId} does not exist on ${cfg.network}`,
  );
  if (!account.evm_address || !isAddressEqual(account.evm_address, operator.address)) {
    throw new Error(
      `OPERATOR_PRIVATE_KEY does not sign for OPERATOR_ACCOUNT_ID ${operator.accountId}: the key's EVM address is ` +
        `${operator.address}, the account's is ${account.evm_address ?? "unset"}. Use the ECDSA key of an account ` +
        "whose EVM address derives from that key (Hedera Portal ECDSA accounts do).",
    );
  }
}

async function vaultBalance(
  cfg: ReadOnlyConfig,
  mirror: MirrorClient,
  vault: Address,
  token: TokenRef,
): Promise<bigint> {
  const balance = await explainNotFound(
    mirror.tokenBalance(vault, token.id),
    `vault ${vault} does not exist on ${cfg.network}; check AUTONR_VAULT_ADDRESS`,
  );
  if (balance === null) {
    throw new Error(
      `vault ${vault} is not associated with ${token.symbol} (${token.id}), so Hedera would reject the transfer. ` +
        `As the vault owner, call associateToken(${token.address}) on the vault, e.g. from the dashboard's Owner page.`,
    );
  }
  return balance;
}

/** Replaces the Mirror Node's generic 404 with what it means for this request. */
async function explainNotFound<T>(request: Promise<T>, message: string): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof MirrorNotFoundError) throw new Error(message, { cause: error });
    throw error;
  }
}

/**
 * Sizes the HBAR to sell for `usdcOut` at the pool's spot price, grossed up by the pool fee, then asks the quoter what
 * that HBAR really buys (price impact included) and allows SWAP_SLIPPAGE_BPS below it.
 */
async function planSwap(cfg: ReadOnlyConfig, usdcOut: bigint): Promise<SwapStep> {
  const { baseToken: whbar, quoteToken: usdc, poolFee: fee } = cfg;
  const state = await getPoolState(cfg, { tokenA: whbar.address, tokenB: usdc.address, fee });
  if (!state) throw new Error(`${missingPoolDetail(cfg)} Check AUTONR_POOL_FEE.`);
  const whbarPerUsdcE18 = poolPriceE18(state, usdc, whbar);
  const atSpot = (usdcOut * whbarPerUsdcE18 * 10n ** BigInt(whbar.decimals)) / 10n ** BigInt(usdc.decimals + 18);
  const tinybars = ceilDiv(atSpot * FEE_UNITS, FEE_UNITS - BigInt(fee));
  const quote = await quotePool(cfg, { tokenIn: whbar.address, tokenOut: usdc.address, fee, amountIn: tinybars });
  return {
    kind: "swap",
    tinybars,
    quote,
    minOut: (quote.amountOut * (10_000n - SWAP_SLIPPAGE_BPS)) / 10_000n,
  };
}

/** Sends one step and returns its transaction id once it has succeeded. */
async function runStep(ctx: Context, step: FundingStep): Promise<string> {
  const { saucerswap } = getNetwork(ctx.cfg.network);
  switch (step.kind) {
    case "associate":
      return associate(ctx, step.token);
    case "wrap":
      return awaitSuccess(
        ctx,
        await sendContractCall(ctx.client, ctx.wallet, {
          to: saucerswap.whbar,
          data: encodeFunctionData({ abi: whbarAbi, functionName: "deposit" }),
          value: step.tinybars * WEIBARS_PER_TINYBAR,
        }),
      );
    case "transfer":
      // HTS tokens answer the ERC-20 interface at their own address, so transfer() moves the operator's balance.
      return awaitSuccess(
        ctx,
        await sendContractCall(ctx.client, ctx.wallet, {
          to: step.token.address,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [ctx.vault, step.amount] }),
        }),
      );
    case "swap": {
      // The router wraps the HBAR it receives, swaps it and pays the output straight to the vault.
      const calls = hbarExactInputCalls({
        path: encodePath(ctx.cfg.baseToken.address, ctx.cfg.poolFee, ctx.cfg.quoteToken.address),
        recipient: ctx.vault,
        // The router compares its deadline with consensus time, not with this machine's clock.
        deadline: BigInt((await chainTimestamp(ctx.client)) + SWAP_DEADLINE_SECONDS),
        amountIn: step.tinybars,
        amountOutMinimum: step.minOut,
      });
      return awaitSuccess(
        ctx,
        await sendContractCall(ctx.client, ctx.wallet, {
          to: saucerswap.router,
          data: encodeFunctionData({ abi: swapRouterAbi, functionName: "multicall", args: [calls] }),
          value: step.tinybars * WEIBARS_PER_TINYBAR,
        }),
      );
    }
  }
}

async function awaitSuccess({ cfg, client }: Context, hash: Hex): Promise<Hex> {
  const receipt = await waitForReceipt(client, hash);
  if (receipt.status !== "success") {
    throw new Error(`transaction ${hash} reverted: ${hashscanUrl(cfg.network, "transaction", hash)}`);
  }
  return hash;
}

/** Associates the operator with a token through the Hedera Token Service, signed with the operator's key. */
async function associate({ cfg, operator, mirror }: Context, token: TokenRef): Promise<string> {
  const client = hederaClient(cfg.network, operator.accountId.toString(), operator.privateKey);
  try {
    const response = await new TokenAssociateTransaction()
      .setAccountId(operator.accountId)
      .setTokenIds([token.id])
      .execute(client);
    try {
      await response.getReceipt(client);
    } catch (error) {
      // The Mirror Node trails consensus by seconds, so an association made just before the plan was read can exist.
      const alreadyAssociated =
        error instanceof ReceiptStatusError && error.status === Status.TokenAlreadyAssociatedToAccount;
      if (!alreadyAssociated) throw error;
    }
    // The receipt comes from a consensus node, but the relay simulates the next transaction (eth_estimateGas) on the
    // Mirror Node, which trails consensus by seconds: wait until it sees the association.
    await waitForTokenBalance(mirror, operator.accountId, token.id, 0n);
    return response.transactionId.toString();
  } finally {
    client.close();
  }
}

/**
 * Polls until the account holds at least `atLeast` of the token and returns the last balance seen (null while it is
 * not associated). The Mirror Node trails consensus by a few seconds, so a read right after a transaction can still
 * show the old balance.
 */
async function waitForTokenBalance(
  mirror: MirrorClient,
  account: string,
  tokenId: string,
  atLeast: bigint,
): Promise<bigint | null> {
  const deadline = Date.now() + MIRROR_CATCH_UP_MS;
  let balance: bigint | null = null;
  while (Date.now() < deadline) {
    try {
      balance = await mirror.tokenBalance(account, tokenId);
      if (balance !== null && balance >= atLeast) break;
    } catch (error) {
      // Still rate-limited after the client's own retries: try again next round. Anything else is a real failure.
      if (!(error instanceof MirrorRequestError && error.status === 429)) throw error;
    }
    await sleep(MIRROR_POLL_MS);
  }
  return balance;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

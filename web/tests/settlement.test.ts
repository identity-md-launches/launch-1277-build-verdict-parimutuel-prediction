import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeFunctionData, parseEther, toHex, type Abi } from "viem";
import { DEFAULT_CHAIN } from "../src/config";
import { attributeSettlements, clientFor } from "../src/chain";
import { leaderboard, unattributedSettlements } from "../src/leaderboard";
import { directSettlementActor, settlementActor, type SettlementTransaction } from "../src/settlement";
import abi from "../src/abi/VerdictMarkets.json";
import type { ChainEvent, MarketView } from "../src/types";

const d = DEFAULT_CHAIN.deployment!;
const alice = d.oracle, bob = d.intake;
const now = 1800000000n, since = now - 604800n;
let nonce = 100n;
function event(name: string, extra: Partial<ChainEvent> = {}): ChainEvent {
  return {
    name, args: { id: 1n, escalation: false }, logIndex: 10,
    blockNumber: d.block, timestamp: now,
    transactionHash: toHex(nonce++, { size: 32 }), ...extra,
  };
}
function market(events: ChainEvent[], slot = 0): MarketView {
  // Settler rankings depend on the event history, irrespective of pool state.
  return { id: 1n, events, market: { params: { collateralId: slot } } } as MarketView;
}
function reward(e: ChainEvent, action: number, amount = parseEther(".05")) {
  return event("SettlerRewarded", {
    transactionHash: e.transactionHash, timestamp: e.timestamp,
    logIndex: e.logIndex + (action < 2 ? 1 : -1),
    args: { id: e.args.id, settler: bob, action, amount },
  });
}
function tx(e: ChainEvent, functionName = "finalize", args = [e.args.id]): SettlementTransaction {
  return {
    hash: e.transactionHash, blockNumber: e.blockNumber, from: alice, to: d.markets,
    input: encodeFunctionData({ abi: abi as Abi, functionName, args }),
  };
}
afterEach(() => vi.restoreAllMocks());

describe("Settler actions and rewards", () => {
  it("counts every zero-reward lifecycle action across IMD and WETH", () => {
    const events = ["OracleAsked", "OutcomeProposed", "Finalized"].map((name) => event(name, { settler: alice }));
    const markets = [market(events), market([event("Voided", { settler: alice })], 1)];
    for (const start of [0n, since])
      expect(leaderboard(markets, "Settlers", "IMD", start)).toEqual([
        expect.objectContaining({ id: alice, rewards: 0n, actions: 4 }),
      ]);
    expect(leaderboard(markets, "Settlers", "WETH")).toEqual([]);
  });
  it("filters actions at the seven-day boundary, retaining all-time activity", () => {
    const events = [since - 1n, since, now].map((timestamp) => event("OracleAsked", { timestamp, settler: alice }));
    expect(leaderboard([market(events)], "Settlers", "IMD")[0].actions).toBe(3);
    expect(leaderboard([market(events)], "Settlers", "IMD", since)[0].actions).toBe(2);
    expect(leaderboard([market([events[0]])], "Settlers", "IMD", since)).toEqual([]);
  });
  it("sums rewards independently and counts rewarded transitions only once", () => {
    const events = ["OracleAsked", "OutcomeProposed", "Finalized", "Voided"].flatMap((name, action) => {
      const e = event(name);
      return [e, reward(e, action, action === 3 ? 0n : parseEther(".05"))];
    });
    expect(leaderboard([market(events)], "Settlers", "IMD")[0]).toMatchObject({ id: bob, rewards: parseEther(".15"), actions: 4 });
    expect(unattributedSettlements([market(events)])).toBe(0);
  });
  it("ignores escalation asks and auxiliary events but counts accepted replacement proposals", () => {
    const events = [
      event("OracleAsked", { settler: alice, args: { id: 1n, escalation: true } }),
      event("OutcomeProposed", { settler: alice, args: { id: 1n, escalation: true } }),
      ...["BountyReturned", "DisputeExtended", "Claimed", "Answered"].map((name) => event(name, { settler: alice })),
    ];
    expect(leaderboard([market(events)], "Settlers", "IMD")[0]).toMatchObject({ rewards: 0n, actions: 1 });
  });
  it("matches reward callers by market, transaction, action and emission order", () => {
    const primary = event("OutcomeProposed"), replacement = event("OutcomeProposed", { transactionHash: primary.transactionHash, logIndex: 20 });
    const firstReward = reward(primary, 1), secondReward = reward(replacement, 1);
    firstReward.args.settler = alice;
    const otherMarket = reward(primary, 1); otherMarket.args.id = 2n;
    const otherAction = reward(primary, 0);
    const events = [primary, replacement, otherMarket, otherAction, secondReward, firstReward];
    expect(settlementActor(primary, events)).toBe(alice);
    expect(settlementActor(replacement, events)).toBe(bob);
  });
  it("reports missing callers for the selected period without inventing a wallet", () => {
    const markets = [market([event("Finalized"), event("Voided", { timestamp: since - 1n })])];
    expect(leaderboard(markets, "Settlers", "IMD")).toEqual([]);
    expect(unattributedSettlements(markets)).toBe(2);
    expect(unattributedSettlements(markets, since)).toBe(1);
  });
});

describe("Settlement transaction attribution", () => {
  it("uses the mined direct caller only for the matching function and market", () => {
    for (const [name, fn, args] of [
      ["OracleAsked", "resolve", [1n, "0x1234"]],
      ["Finalized", "finalize", [1n]],
      ["Voided", "voidMarket", [1n]],
    ] as const) {
      const e = event(name);
      expect(directSettlementActor(e, tx(e, fn, [...args]), d.markets)).toBe(alice);
    }
    const e = event("Finalized"), valid = tx(e);
    for (const invalid of [
      { ...valid, to: bob }, { ...valid, hash: toHex(0n, { size: 32 }) },
      { ...valid, blockNumber: null }, { ...valid, blockNumber: e.blockNumber + 1n },
      tx(e, "voidMarket"), tx(e, "finalize", [2n]), { ...valid, input: "0x1234" as const },
    ]) expect(directSettlementActor(e, invalid, d.markets)).toBeUndefined();
  });
  it("loads callers once, preserves reward recipients and retries failed lookups", async () => {
    const e = event("Finalized"), rewarded = event("Voided"), paid = reward(rewarded, 3);
    const getTransaction = vi.spyOn(clientFor(DEFAULT_CHAIN), "getTransaction")
      .mockRejectedValueOnce(new Error("RPC unavailable"))
      .mockResolvedValue(tx(e) as Awaited<ReturnType<ReturnType<typeof clientFor>["getTransaction"]>>);
    await attributeSettlements(DEFAULT_CHAIN, [e, rewarded, paid]);
    expect(e.settler).toBeUndefined();
    expect(settlementActor(rewarded, [rewarded, paid])).toBe(bob);
    await attributeSettlements(DEFAULT_CHAIN, [e, rewarded, paid]);
    expect(e.settler).toBe(alice);
    await attributeSettlements(DEFAULT_CHAIN, [{ ...e, settler: undefined }]);
    expect(getTransaction).toHaveBeenCalledTimes(2);
  });
});

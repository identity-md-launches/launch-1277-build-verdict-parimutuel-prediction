import { describe, expect, it, vi } from "vitest";
import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  parseEther,
  type Abi,
  type Hex,
} from "viem";
import fixture from "./intake-v2-fixture.json";
import oracleAbi from "../src/abi/VerdictOracle.json";
import { loadMetadata, metadataUrl } from "../src/metadata";
import { DEFAULT_CHAIN } from "../src/config";
import {
  amount,
  attestationParam,
  feeSplit,
  minimumBounty,
  recoverAttestation,
  proposalReason,
  utcTime,
  marketMetadata,
  marketStatus,
} from "../src/domain";
import {
  buildMarket,
  createDefaults,
  evidenceDefaults,
  timeDefaults,
} from "../src/create";
import { leaderboard } from "../src/leaderboard";
import type {
  ChainEvent,
  CollateralConfig,
  Market,
  MarketView,
} from "../src/types";
const d = DEFAULT_CHAIN.deployment!,
  E = parseEther;
const now = BigInt(Date.parse("2026-10-12T00:00:00Z") / 1000);
const zeroHash = `0x${"0".repeat(64)}` as Hex;
const walletA = d.markets,
  walletB = d.oracle;
function event(
  name: string,
  args: Record<string, unknown>,
  timestamp = now,
): ChainEvent {
  return {
    name,
    args,
    transactionHash: zeroHash,
    blockNumber: d.block,
    logIndex: 0,
    timestamp,
  };
}
function view(id: number, status = 2, slot = 0): MarketView {
  const input = {
    ...createDefaults(now),
    question: "Will it happen?",
    fromBlock: "100",
    toBlock: "200",
    bounty: "1.25",
    collateralId: String(slot),
  };
  const built = buildMarket(input, DEFAULT_CHAIN, E("0.5"), now, E("0.25"));
  const m: Market = {
    params: built.params,
    creator: walletA,
    bodyHash: zeroHash,
    escalationBodyHash: zeroHash,
    status,
    outcomes: 2,
    outcome: 1,
    asks: 1,
    panelSize: 5,
    escalationAsked: false,
    escalated: false,
    lastPrimaryAsk: now,
    disputeEnds: now,
    pool: E("10"),
    bountyRemaining: 0n,
    oracleSpend: E("0.5"),
    fees: E("0.25"),
    returnedBounty: E("0.6"),
    paidOut: 0n,
    refunded: 0n,
    remainingPayout: E("9.75"),
    remainingWinningStake: E("4"),
    primaryRequests: [zeroHash, zeroHash],
    escalationRequest: zeroHash,
    escalationAskedAt: 0n,
    settlerReward: E("0.05"),
    rewardsPaid: E("0.15"),
    collateral: slot === 0 ? d.token : d.weth,
    bountyToken: d.token,
  };
  const created = event("MarketCreated", {
    id: BigInt(id),
    creator: walletA,
    agentId: 1n,
  });
  return {
    id: BigInt(id),
    market: m,
    created,
    rawBody: built.primary,
    body: built.body,
    rawEscalation: built.escalation,
    pools: [E("6"), E("4")],
    answers: [],
    events: [
      created,
      event("BetPlaced", {
        id: BigInt(id),
        bettor: walletA,
        outcome: 1,
        amount: E("4"),
        agentId: 1n,
      }),
      event("BetPlaced", {
        id: BigInt(id),
        bettor: walletB,
        outcome: 0,
        amount: E("6"),
        agentId: 2n,
      }),
      event(status === 3 ? "Voided" : "Finalized", {
        id: BigInt(id),
        creatorFee: E(".15"),
        burnFee: E(".05"),
        treasuryFee: E(".05"),
      }),
    ],
  };
}
describe("Intake v2 supplied historical fixture", () => {
  it("decodes complete 0x0f6261af and matches the exact supplied attestation hash", () => {
    expect(fixture.transaction.hash).toBe(
      "0x6fde2f00922dee130e2baff65d7b69cea6a2d309f350f3ee70569540368cf8c8",
    );
    expect(fixture.transaction.input.slice(0, 10)).toBe("0x0f6261af");
    const decoded = fixture.receipt.logs.flatMap((l) => {
      try {
        const x = decodeEventLog({
          abi: oracleAbi as Abi,
          data: l.data as Hex,
          topics: l.topics as [Hex, ...Hex[]],
        });
        return [
          {
            ...event(
              String(x.eventName),
              x.args as unknown as Record<string, unknown>,
            ),
            transactionHash: fixture.transaction.hash as Hex,
          },
        ];
      } catch {
        return [];
      }
    });
    const answered = decoded.find((e) => e.name === "Answered")!;
    expect(answered).toBeDefined();
    const att = recoverAttestation(fixture.transaction.input as Hex, answered);
    expect(keccak256(encodeAbiParameters([attestationParam], [att]))).toBe(
      "0xbc73ea73342c3d01812021081a175e84761c5b55636dce4c32d0b44057cdc811",
    );
  });
});
describe("Mainnet economics and creator defaults", () => {
  const c = (slot: number): CollateralConfig => ({
    token: slot ? d.weth : d.token,
    creatorFeeBps: 150,
    burnFeeBps: slot ? 0 : 50,
    treasuryFeeBps: slot ? 100 : 50,
    maxPoolPerMarket: E(slot ? "1" : "500"),
  });
  it("takes each token's fees separately, with integer rounding per fee", () => {
    expect(feeSplit(E("100"), c(0))).toEqual({
      creator: E("1.5"),
      burn: E(".5"),
      treasury: E(".5"),
      total: E("2.5"),
      payout: E("97.5"),
    });
    expect(feeSplit(E("1"), c(1))).toEqual({
      creator: E(".015"),
      burn: 0n,
      treasury: E(".01"),
      total: E(".025"),
      payout: E(".975"),
    });
    expect(feeSplit(199n, c(0))).toEqual({
      creator: 2n,
      burn: 0n,
      treasury: 0n,
      total: 2n,
      payout: 197n,
    });
  });
  it("requires two oracle prices plus five IMD rewards", () => {
    expect(minimumBounty(E(".5"), E(".05"))).toBe(E("1.25"));
    const input = {
      ...createDefaults(now),
      question: "A question",
      fromBlock: "1",
      toBlock: "2",
      bounty: "1.249999999999999999",
    };
    expect(() =>
      buildMarket(input, DEFAULT_CHAIN, E(".5"), now, E(".25")),
    ).toThrow("2 × oracle");
    const result = buildMarket(
      { ...input, bounty: "1.25", collateralId: "1" },
      DEFAULT_CHAIN,
      E(".5"),
      now,
      E(".25"),
    );
    expect(result.params.collateralId).toBe(1);
    expect(result.body.consumer).toEqual({
      chainId: 1,
      verifyingContract: d.oracle,
    });
    expect(marketMetadata(result.args[3]).targetTime).toBe(now + 86400n);
  });
  it("defaults to UTC T−2h, T+45m, 3-day answer window, 2-day refund delay, 2-hour dispute", () => {
    const target = BigInt(Date.parse("2026-10-15T22:00:00Z") / 1000),
      schedule = timeDefaults(target);
    expect(schedule).toEqual({
      targetAt: "2026-10-15T22:00",
      closeAt: "2026-10-15T20:00",
      answerFrom: "2026-10-15T22:45",
      answerUntil: "2026-10-18T22:45",
      voidAfter: "2026-10-20T22:45",
      disputeHours: "2",
    });
    expect(utcTime(target)).toBe("Thu 15 Oct 22:00 UTC");
    expect(
      evidenceDefaults(100000n, target - 10000n, target, target - 7200n, 12.5),
    ).toEqual({ fromBlock: "100296", toBlock: "100800" });
  });
  it("rejects excess reward, sub-hour answer windows, distant refunds, invalid slots and uint256 overflow", () => {
    const input = {
      ...createDefaults(now),
      question: "A question",
      fromBlock: "1",
      toBlock: "2",
      bounty: "1.25",
    };
    for (const change of [
      { settlerReward: "0.26" },
      { answerUntil: input.answerFrom },
      { voidAfter: "2027-10-13T00:00" },
      { collateralId: "2" },
      { bounty: (2n ** 256n).toString() },
    ])
      expect(() =>
        buildMarket(
          { ...input, ...change },
          DEFAULT_CHAIN,
          E(".5"),
          now,
          E(".25"),
        ),
      ).toThrow();
  });
  it("only permits the latest primary answer and the requested escalation", () => {
    const m = view(1).market,
      old = `0x${"1".repeat(64)}` as Hex,
      latest = `0x${"2".repeat(64)}` as Hex;
    m.status = 0;
    m.asks = 2;
    m.primaryRequests = [old, latest];
    expect(
      proposalReason(m, event("Answered", { intakeRequestId: old })),
    ).toContain("latest");
    expect(
      proposalReason(m, event("Answered", { intakeRequestId: latest })),
    ).toBeUndefined();
    m.status = 1;
    m.escalationRequest = latest;
    expect(
      proposalReason(m, event("Answered", { intakeRequestId: old })),
    ).toContain("escalation");
  });
});
it("a superseded answer does not mark the latest pending ask as answered", () => {
 const m = view(1).market; m.status=0; m.params.closeAt=now-1n;
 const asks=[event("OracleAsked",{intakeRequestId:"old",escalation:false}),event("OracleAsked",{intakeRequestId:"latest",escalation:false})];
 expect(marketStatus(m,asks,[event("Answered",{intakeRequestId:"old"})],now)).toBe("Asked");
 expect(marketStatus(m,asks,[event("Answered",{intakeRequestId:"latest"})],now)).toBe("Answered");
});
describe("Leaderboard economic results", () => {
  it("keeps the negative sign on losses below one token", () => {
    expect(amount(-E(".75"))).toBe("−0.75");
    expect(amount(-1n)).toBe("−<0.001");
  });
  it("includes unclaimed wins, losses and zero-result voids, never mixing tokens", () => {
    const markets = [view(1), view(2), view(3), view(4, 3), view(5, 2, 1)];
    const traders = leaderboard(markets, "Traders", "IMD");
    expect(traders[0]).toMatchObject({
      id: walletA,
      net: E("17.25"),
      finalized: 3,
      played: 4,
      wins: 3,
      volume: E("16"),
    });
    expect(traders[1]).toMatchObject({
      id: walletB,
      net: -E("18"),
      finalized: 3,
      wins: 0,
      volume: E("24"),
    });
    expect(leaderboard(markets, "Traders", "WETH")).toEqual([]);
    expect(leaderboard(markets, "Agents", "IMD")[0]).toMatchObject({
      id: "1",
      net: E("17.25"),
      finalized: 3,
    });
  });
  it("uses actual claims when present and respects settlement-time 7-day boundaries", () => {
    const markets = [view(1), view(2), view(3)];
    markets[0].events.push(
      event("Claimed", { bettor: walletA, amount: E("9.75") }),
    );
    expect(leaderboard(markets, "Traders", "IMD")[0].net).toBe(E("17.25"));
    markets[0].events.at(-2)!.timestamp = now - 604801n;
    expect(leaderboard(markets, "Traders", "IMD", now - 604800n)).toEqual([]);
  });
  it("ranks creator fees per token and settler rewards in IMD across tokens", () => {
    const a = view(1),
      b = view(2, 2, 1);
    a.events.push(
      event("SettlerRewarded", {
        settler: walletB,
        amount: E(".05"),
        action: 0,
      }),
    );
    b.events.push(
      event("SettlerRewarded", {
        settler: walletB,
        amount: E(".05"),
        action: 2,
      }),
    );
    expect(leaderboard([a, b], "Creators", "IMD")[0]).toMatchObject({
      created: 1,
      fees: E(".15"),
      volume: E("10"),
    });
    expect(leaderboard([a, b], "Settlers", "IMD")[0]).toMatchObject({
      rewards: E(".1"),
      actions: 2,
    });
    expect(leaderboard([a, b], "Settlers", "WETH")).toEqual([]);
  });
  it("combines multiple wallets using one agent ID and allocates wallet claims without duplicating winnings", () => {
    const markets = [view(1), view(2), view(3)];
    for (const v of markets)
      v.events.find(
        (e) => e.name === "BetPlaced" && e.args.bettor === walletB,
      )!.args.agentId = 1n;
    expect(leaderboard(markets, "Agents", "IMD")[0]).toMatchObject({
      id: "1",
      net: -E(".75"),
      finalized: 3,
      volume: E("30"),
    });
  });
});

describe("Creator URI titles", () => {
  it("reads inline JSON, data URIs and literal titles without executing markup", async () => {
    expect(
      marketMetadata('{"title":"<script>not executable</script>"}').title,
    ).toBe("<script>not executable</script>");
    expect(
      (
        await loadMetadata(
          "data:application/json," + encodeURIComponent('{"name":"A market"}'),
        )
      ).title,
    ).toBe("A market");
    expect(marketMetadata("A plain title").title).toBe("A plain title");
    expect(metadataUrl("javascript:alert(1)")).toBeUndefined();
    expect(metadataUrl("https://localhost/title.json")).toBeUndefined();
  });
  it("reads linked JSON with no credentials, caps bytes and handles unavailable metadata", async () => {
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"title":"Linked market"}'))
      .mockResolvedValueOnce(new Response("x".repeat(65537)))
      .mockRejectedValueOnce(new Error("offline"));
    try {
      expect(
        (await loadMetadata("https://example.com/market-one.json")).title,
      ).toBe("Linked market");
      expect(mock.mock.calls[0][1]).toMatchObject({
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      expect(
        (await loadMetadata("https://example.com/oversized.json")).title,
      ).toBeUndefined();
      expect(
        (await loadMetadata("https://example.com/unavailable.json")).title,
      ).toBeUndefined();
    } finally {
      mock.mockRestore();
    }
  });
});

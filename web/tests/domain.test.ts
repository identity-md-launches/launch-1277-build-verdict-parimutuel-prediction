import { describe, expect, it } from "vitest";
import {
  decodeAbiParameters,
  decodeEventLog,
  type Abi,
  encodeAbiParameters,
  hexToString,
  keccak256,
  toHex,
  type Hex,
  type Log,
} from "viem";
import fixture from "./chain-fixture.json";
import legacyAbi from "./legacy-markets-abi.json";
import oracleAbi from "../src/abi/VerdictOracle.json";
import { DEFAULT_CHAIN } from "../src/config";
import { decodeLogs, logRanges } from "../src/chain";
import {
  attestationParam,
  canonical,
  claimable,
  composeBodies,
  marketStatus,
  outcomeLabels,
  panelUUID,
  parseBody,
  questionHash,
  rankAgents,
  recoverAttestation,
} from "../src/domain";
import {
  buildMarket as buildActual,
  expectedBlockAtClose,
  type CreateInput,
} from "../src/create";
import type { Market, MarketView } from "../src/types";
const buildMarket = (
  input: CreateInput,
  config: typeof DEFAULT_CHAIN,
  price: bigint,
  now: bigint,
) =>
  buildActual(
    input,
    config,
    price,
    now === 1n ? 1893369600n : now,
    250000000000000000n,
  );
const events = fixture.logs.flatMap((log) => {
  try {
    const d = decodeEventLog({
      abi: (log.address.toLowerCase() ===
      "0xf9e8362469be9944e7e79732bcea9bcecb4ae25d"
        ? oracleAbi
        : legacyAbi) as Abi,
      data: log.data as Hex,
      topics: log.topics as [Hex, ...Hex[]],
    });
    return [
      {
        name: d.eventName!,
        args: d.args as Record<string, any>,
        transactionHash: log.transactionHash as Hex,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.logIndex,
      },
    ];
  } catch {
    return [];
  }
});
const created = events.find(
  (e) => e.name === "MarketCreated" && e.args.id === 1n,
)!;
const body = parseBody(created.args.body).body!;
const answer = events.find((e) => e.name === "Answered")!;
function reviveMarket(i: number): Market {
  const m = fixture.markets[i].market;
  const p = m.params;
  return {
    ...m,
    params: {
      ...p,
      questionHash: p.questionHash as Hex,
      dataChainId: BigInt(p.dataChainId),
      fromBlock: BigInt(p.fromBlock),
      toBlock: BigInt(p.toBlock),
      closeAt: BigInt(p.closeAt),
      answerFrom: BigInt(p.answerFrom),
      answerUntil: BigInt(p.answerUntil),
      voidAfter: BigInt(p.voidAfter),
      bounty: BigInt(p.bounty),
      bounds: p.bounds.map(BigInt),
      keys: p.keys as Hex[],
    },
    ...Object.fromEntries(
      [
        "lastPrimaryAsk",
        "disputeEnds",
        "pool",
        "bountyRemaining",
        "oracleSpend",
        "fees",
        "returnedBounty",
        "paidOut",
        "refunded",
        "remainingPayout",
        "remainingWinningStake",
        "escalationAskedAt",
      ].map((k) => [k, BigInt((m as any)[k])]),
    ),
  } as unknown as Market;
}
describe("Pinned Sepolia records", () => {
  it("matches market 1 canonical questionHash", () => {
    expect(body.question).toBe(
      "Does WETH9 (0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) on Ethereum mainnet return exactly 18 for decimals() at the window's last block?",
    );
    expect(questionHash(body)).toBe(
      "0x50477e7b428ae78e43a979cc48ce0a7524746a0579d03570944489ff3ee3e800",
    );
    expect(keccak256(created.args.body)).toBe(created.args.bodyHash);
  });
  it("decodes the example complete transaction and verifies Answered attHash", () => {
    expect(fixture.tx.hash).toBe(
      "0x56f6682a2dafbed218caa9d9cb798795e6257b557ba8309e6850c9134f5420f5",
    );
    const att = recoverAttestation(fixture.tx.input as Hex, answer, [
      created.args.bodyHash,
    ]);
    expect(keccak256(encodeAbiParameters([attestationParam], [att]))).toBe(
      answer.args.attHash,
    );
    expect(decodeAbiParameters([{ type: "bool" }], att.answer)[0]).toBe(true);
    expect(att.questionHash).toBe(questionHash(body));
    expect(att.panelSize).toBe(5);
    expect(att.agreed).toBeGreaterThanOrEqual(att.quorum);
    expect(panelUUID(att.panelJobId)).toMatch(
      /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/,
    );
  });
  it("rejects mismatched hash, request ID and unrelated body", () => {
    expect(() =>
      recoverAttestation(fixture.tx.input as Hex, {
        ...answer,
        args: { ...answer.args, attHash: keccak256(toHex("tampered")) },
      }),
    ).toThrow("hash");
    expect(() =>
      recoverAttestation(fixture.tx.input as Hex, {
        ...answer,
        args: { ...answer.args, intakeRequestId: keccak256(toHex("other")) },
      }),
    ).toThrow("request");
    expect(() =>
      recoverAttestation(fixture.tx.input as Hex, answer, [
        keccak256(toHex("other")),
      ]),
    ).toThrow("Body hash");
  });
  it("market 1 is Finalized, Yes; market 2 is Voided", () => {
    const one = reviveMarket(0),
      two = reviveMarket(1),
      now = BigInt(fixture.block.timestamp);
    expect(marketStatus(one, events, [answer], now)).toBe("Finalized");
    expect(outcomeLabels(one.params)[one.outcome]).toBe("Yes");
    expect(marketStatus(two, events, [], now)).toBe("Voided");
  });
});
describe("Outcome and lifecycle rules", () => {
  it("labels bool, 18-decimal buckets, address and bytes32 lists", () => {
    expect(outcomeLabels({ answerType: 0, bounds: [], keys: [] })).toEqual([
      "No",
      "Yes",
    ]);
    expect(
      outcomeLabels({
        answerType: 3,
        bounds: [10n ** 18n, 25n * 10n ** 17n],
        keys: [],
      }),
    ).toEqual(["Below 1", "1 to under 2.5", "2.5 and above"]);
    const address = DEFAULT_CHAIN.deployment!.token;
    const key = ("0x" + address.slice(2).padStart(64, "0")) as Hex;
    expect(outcomeLabels({ answerType: 4, bounds: [], keys: [key] })).toEqual([
      address,
      "None of these",
    ]);
    const text = toHex("Wuhan", { size: 32 });
    expect(hexToString(text, { size: 32 })).toBe("Wuhan");
    expect(outcomeLabels({ answerType: 5, bounds: [], keys: [text] })).toEqual([
      text,
      "None of these",
    ]);
  });
  it("distinguishes closed, asked, matched answered and provisional", () => {
    const m = { ...reviveMarket(0), status: 0 };
    const asked = events.filter((e) => e.name === "OracleAsked");
    expect(marketStatus(m, [], [], m.params.closeAt - 1n)).toBe("Open");
    expect(marketStatus(m, [], [], m.params.closeAt)).toBe("Closed");
    expect(marketStatus(m, asked, [], m.params.closeAt)).toBe("Asked");
    expect(marketStatus(m, asked, [answer], m.params.closeAt)).toBe("Answered");
    expect(marketStatus(m, [], [answer], m.params.closeAt)).toBe("Closed");
    expect(
      marketStatus({ ...m, status: 1 }, asked, [answer], m.disputeEnds),
    ).toBe("Provisional");
  });
  it("calculates refunds and the final winning claimant residual exactly", () => {
    const m = reviveMarket(0);
    const pools = [5n * 10n ** 18n, 10n * 10n ** 18n];
    expect(
      claimable(
        { ...m, remainingPayout: 11n, remainingWinningStake: 3n },
        pools,
        { stakes: [0n, 3n], total: 3n, claimed: false },
      ),
    ).toBe(11n);
    expect(
      claimable(reviveMarket(1), pools, {
        stakes: [5n, 0n],
        total: 5n,
        claimed: false,
      }),
    ).toBe(5n);
    expect(
      claimable(reviveMarket(1), pools, {
        stakes: [5n, 0n],
        total: 5n,
        claimed: true,
      }),
    ).toBe(0n);
  });
  it("chunks inclusively into at most 5,000 blocks without gaps", () => {
    expect(logRanges(5n, 20005n)).toEqual([
      [5n, 5004n],
      [5005n, 10004n],
      [10005n, 15004n],
      [15005n, 20004n],
      [20005n, 20005n],
    ]);
    expect(logRanges(5n, 4n)).toEqual([]);
    expect(() => logRanges(1n, 2n, 5001n)).toThrow();
  });
  it("aggregates caller-provided agent IDs, including people", () => {
    const markets = fixture.markets.map((x, i) => ({
      id: BigInt(x.id),
      market: reviveMarket(i),
      created: events.find(
        (e) => e.name === "MarketCreated" && e.args.id === BigInt(x.id),
      )!,
      events: events.filter((e) => e.args.id === BigInt(x.id)),
      rawBody: "",
      rawEscalation: "",
      pools: [],
      answers: [],
    })) as MarketView[];
    expect(rankAgents(markets, "volume")[0]).toEqual({
      id: "0",
      created: 2,
      volume: 20n * 10n ** 18n,
      bets: 3,
      betVolume: 20n * 10n ** 18n,
    });
  });
});
describe("Creator documents", () => {
  it("serializes integer-like keys lexicographically, including nested definitions", () => {
    expect(canonical({ definitions: { "2": "two", "10": "ten" } })).toBe(
      '{"definitions":{"10":"ten","2":"two"}}',
    );
    expect(canonical({ z: [{ "2": null, "10": [2, 1] }], a: true })).toBe(
      '{"a":true,"z":[{"10":[2,1],"2":null}]}',
    );
    expect(
      questionHash({ ...body, definitions: { "2": "two", "10": "ten" } }),
    ).toBe(
      "0x0a41f72a223cc698a45e850e2ff389ae113890033df5b0fef53320ee31a7f53b",
    );
  });
  it("sorts nested keys, omits chain evidence from question hash, includes definitions", () => {
    expect(canonical({ z: 1, a: { z: 2, a: 3 } })).toBe(
      '{"a":{"a":3,"z":2},"z":1}',
    );
    expect(questionHash({ ...body, evidence: undefined })).toBe(
      questionHash(body),
    );
    expect(questionHash({ ...body, evidence: "web" })).not.toBe(
      questionHash(body),
    );
    expect(questionHash({ ...body, definitions: {} })).toBe(questionHash(body));
    expect(
      questionHash({ ...body, definitions: { metric: "value" } }),
    ).not.toBe(questionHash(body));
  });
  it("doubles the escalation panel and quorum while preserving the canonical question", () => {
    const result = composeBodies(body),
      escalated = JSON.parse(result.escalation);
    expect(escalated.panelSize).toBe(10);
    expect(escalated.quorum).toBe(8);
    expect(questionHash(escalated)).toBe(result.questionHash);
    expect(result.primary).toBe(JSON.stringify(body));
  });
  const input: CreateInput = {
    title: "Threshold",
    targetAt: "2030-01-01T02:00",
    settlerReward: "0.05",
    collateralId: "0",
    question: "Will the measured value exceed the threshold?",
    dataChainId: String(DEFAULT_CHAIN.chainId),
    answerType: "bool",
    fromBlock: "20000000",
    toBlock: "20000010",
    panelSize: "5",
    quorum: "4",
    evidence: "chain",
    toleranceBps: "",
    definitions: "",
    bounds: "",
    keys: "",
    closeAt: "2030-01-01T00:00",
    answerFrom: "2030-01-02T00:00",
    answerUntil: "2030-01-03T00:00",
    voidAfter: "2030-01-04T00:00",
    disputeHours: "24",
    bounty: "1.25",
    agentId: "0",
  };
  it("builds valid bool, uint and list params; rejects invalid schedules and bounds", () => {
    const built = buildMarket(input, DEFAULT_CHAIN, 5n * 10n ** 17n, 1n);
    expect(built.params.answerType).toBe(0);
    expect(built.args[1]).toBe(toHex(built.primary));
    expect(
      buildMarket(
        { ...input, answerType: "uint256", bounds: "1, 2.5" },
        DEFAULT_CHAIN,
        0n,
        1n,
      ).params.bounds,
    ).toEqual([10n ** 18n, 25n * 10n ** 17n]);
    const list = buildMarket(
      { ...input, answerType: "bytes32[]", keys: "Alpha\nBeta" },
      DEFAULT_CHAIN,
      0n,
      1n,
    );
    expect(hexToString(list.params.keys[0], { size: 32 })).toBe("Alpha");
    expect(() =>
      buildMarket(
        { ...input, answerFrom: input.answerUntil },
        DEFAULT_CHAIN,
        0n,
        1n,
      ),
    ).toThrow("at least 1 hour");
    expect(() =>
      buildMarket(
        { ...input, answerType: "uint256", bounds: "2,1" },
        DEFAULT_CHAIN,
        0n,
        1n,
      ),
    ).toThrow("increasing");
    expect(() =>
      buildMarket({ ...input, quorum: "6" }, DEFAULT_CHAIN, 0n, 1n),
    ).toThrow();
    expect(() =>
      buildMarket(
        { ...input, bounty: "0.5" },
        DEFAULT_CHAIN,
        5n * 10n ** 17n,
        1n,
      ),
    ).toThrow("2 × oracle");
  });
  it("estimates the evidence chain closing block, rounding conservatively", () => {
    expect(expectedBlockAtClose(1000n, 100n, 125n, 12)).toBe(1003n);
  });
});

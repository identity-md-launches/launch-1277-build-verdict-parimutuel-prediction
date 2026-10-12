import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  formatUnits,
  hexToString,
  keccak256,
  parseAbi,
  toHex,
  type AbiParameter,
  type Hex,
} from "viem";
import oracle from "./abi/VerdictOracle.json";
import type {
  Attestation,
  Body,
  ChainEvent,
  Market,
  MarketView,
  Position,
  Status,
  CollateralConfig,
  TokenSymbol,
} from "./types";
export const completeAbi = parseAbi([
  "function complete(bytes32 requestId, uint8 status, bytes32 resultHash, string uri, bytes args)",
]);
export const attestationParam = oracle.find(
  (x) => x.type === "function" && x.name === "answerOf",
)!.inputs![0] as AbiParameter;
export function canonical(value: unknown): string {
  // Serialize entries directly: JSON.stringify reorders integer-like object keys.
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
export function questionHash(
  body: Pick<Body, "question" | "chainId" | "window" | "answerType"> &
    Partial<Body>,
): Hex {
  const document: Record<string, unknown> = {
    v: 1,
    window: body.window,
    chainId: body.chainId,
    question: body.question,
    answerType: body.answerType,
  };
  if (body.evidence && body.evidence !== "chain")
    document.evidence = body.evidence;
  if (body.definitions && Object.keys(body.definitions).length)
    document.definitions = body.definitions;
  return keccak256(toHex(canonical(document)));
}
export function composeBodies(body: Body): {
  primary: string;
  escalation: string;
  questionHash: Hex;
} {
  return {
    primary: JSON.stringify(body),
    escalation: JSON.stringify({
      ...body,
      panelSize: body.panelSize * 2,
      quorum: body.quorum * 2,
    }),
    questionHash: questionHash(body),
  };
}
export function parseBody(bytes: Hex): {
  raw: string;
  body?: Body;
  error?: string;
} {
  let raw = bytes;
  try {
    raw = hexToString(bytes) as Hex;
    const body = JSON.parse(raw);
    if (
      typeof body.question !== "string" ||
      !body.window ||
      !Number.isSafeInteger(body.chainId) ||
      typeof body.answerType !== "string" ||
      !Number.isInteger(body.panelSize) ||
      !Number.isInteger(body.quorum)
    )
      throw Error(
        "Missing question, chain, window, answer type or panel fields.",
      );
    return { raw, body };
  } catch {
    return {
      raw,
      error:
        "This on-chain body is not a supported question document. Inspect the raw bytes before interacting.",
    };
  }
}
export function units(value: bigint): string {
  return formatUnits(value, 18);
}
export function amount(value: bigint, digits = 3): string {
  const sign = value < 0n ? "−" : "";
  const absolute = value < 0n ? -value : value;
  const [whole, fraction] = units(absolute).split(".");
  const significant = (fraction || "").slice(0, digits).replace(/0+$/, "");
  if (absolute > 0n && whole === "0" && !significant)
    return `${sign}<${digits ? "0." + "0".repeat(digits - 1) + "1" : "1"}`;
  return (
    sign +
    BigInt(whole).toLocaleString() +
    (significant ? "." + significant : "")
  );
}
export function outcomeLabels(
  p: Pick<Market["params"], "answerType" | "bounds" | "keys">,
): string[] {
  if (p.answerType === 0) return ["No", "Yes"];
  if (p.answerType === 3)
    return [
      `Below ${units(p.bounds[0])}`,
      ...p.bounds
        .slice(0, -1)
        .map((v, i) => `${units(v)} to under ${units(p.bounds[i + 1])}`),
      `${units(p.bounds.at(-1)!)} and above`,
    ];
  if (p.answerType === 4 || p.answerType === 5)
    return [
      ...p.keys.map((k) => (p.answerType === 4 ? "0x" + k.slice(-40) : k)),
      "None of these",
    ];
  return ["Unsupported answer type"];
}
export function marketStatus(
  m: Market,
  events: ChainEvent[],
  answers: ChainEvent[],
  now: bigint,
): Status {
  if (m.status === 3) return "Voided";
  if (m.status === 2) return "Finalized";
  if (m.status === 1) return "Provisional";
  if (now < m.params.closeAt) return "Open";
  const asked = events.filter((e) => e.name === "OracleAsked");
  const latestPrimary = [...asked].reverse().find(e => !e.args.escalation);
  if (latestPrimary && answers.some(a => a.args.intakeRequestId === latestPrimary.args.intakeRequestId)) return "Answered";
  if (asked.length) return "Asked";
  return "Closed";
}
export function recoverAttestation(
  input: Hex,
  answered: ChainEvent,
  expectedBodies?: Hex[],
): Attestation {
  const call = decodeFunctionData({ abi: completeAbi, data: input });
  if (call.functionName !== "complete")
    throw Error("Transaction is not Intake.complete.");
  const [intakeRequestId, attestation] = decodeAbiParameters(
    [{ type: "bytes32" }, attestationParam, { type: "bytes" }],
    call.args[4],
  ) as unknown as [Hex, Attestation, Hex];
  if (
    intakeRequestId.toLowerCase() !==
      answered.args.intakeRequestId.toLowerCase() ||
    call.args[0].toLowerCase() !== intakeRequestId.toLowerCase()
  )
    throw Error("Intake request does not match the Answered event.");
  if (
    attestation.requestId.toLowerCase() !==
    answered.args.requestId.toLowerCase()
  )
    throw Error("Oracle request does not match the Answered event.");
  if (
    expectedBodies &&
    !expectedBodies.some(
      (b) => b.toLowerCase() === answered.args.bodyHash.toLowerCase(),
    )
  )
    throw Error("Body hash does not belong to this market.");
  const hash = keccak256(
    encodeAbiParameters([attestationParam], [attestation]),
  );
  if (hash.toLowerCase() !== answered.args.attHash.toLowerCase())
    throw Error("Attestation hash does not match the on-chain Answered event.");
  return attestation;
}
export function panelUUID(value: Hex): string {
  const s = value.slice(2, 34);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
export function decodeAnswer(a: Attestation): string {
  const types: Record<number, string> = {
    0: "bool",
    1: "address",
    2: "bytes32",
    3: "uint256",
    4: "address[]",
    5: "bytes32[]",
  };
  if (!types[a.answerType]) return a.answer;
  try {
    const [v] = decodeAbiParameters([{ type: types[a.answerType] }], a.answer);
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "bigint") return units(v) + " (18-decimal units)";
    return Array.isArray(v)
      ? v.length
        ? v.join(", ")
        : "Empty list"
      : String(v);
  } catch {
    return "Cannot decode answer: " + a.answer;
  }
}
export function claimable(
  m: Market,
  pools: bigint[],
  p: Pick<Position, "stakes" | "total" | "claimed">,
): bigint {
  if (p.claimed) return 0n;
  if (m.status === 3) return p.total;
  if (m.status !== 2) return 0n;
  const stake = p.stakes[m.outcome] || 0n;
  if (!stake) return 0n;
  if (stake === m.remainingWinningStake) return m.remainingPayout;
  return pools[m.outcome] ? (stake * (m.pool - m.fees)) / pools[m.outcome] : 0n;
}
export function rankAgents(
  markets: MarketView[],
  by: "volume" | "created" | "bets",
) {
  const ranks = new Map<
    string,
    {
      id: string;
      created: number;
      volume: bigint;
      bets: number;
      betVolume: bigint;
    }
  >();
  const get = (id: unknown) => {
    const key = String(id);
    if (!ranks.has(key))
      ranks.set(key, {
        id: key,
        created: 0,
        volume: 0n,
        bets: 0,
        betVolume: 0n,
      });
    return ranks.get(key)!;
  };
  for (const m of markets) {
    const creator = get(m.created.args.agentId);
    creator.created++;
    creator.volume += m.market.pool;
    for (const b of m.events.filter((e) => e.name === "BetPlaced")) {
      const bettor = get(b.args.agentId);
      bettor.bets++;
      bettor.betVolume += b.args.amount;
    }
  }
  return [...ranks.values()].sort((a, b) =>
    a[by] > b[by] ? -1 : a[by] < b[by] ? 1 : a.id.localeCompare(b.id),
  );
}
export function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
export function countdown(end: bigint, now: bigint): string {
  const s = Number(end - now);
  if (s <= 0) return "Ended";
  if (s >= 86400)
    return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600)
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const err = e as {
      shortMessage?: string;
      message?: string;
      cause?: unknown;
      data?: { errorName?: string };
    };
    if (err.data?.errorName) return explainRevert(err.data.errorName);
    if (err.cause) {
      const nested = errorMessage(err.cause);
      if (nested) return nested;
    }
    return (
      err.shortMessage ||
      err.message ||
      "RPC request failed. Try refreshing."
    ).slice(0, 400);
  }
  return String(e);
}
function explainRevert(name: string): string {
  const reasons: Record<string, string> = {
    WrongState: "The market is not in a state that accepts this action.",
    OutsideWindow:
      "The contract’s time window does not allow this action yet, or has ended.",
    NothingToClaim: "This wallet has no unclaimed payout or refund.",
    NoWinningStake:
      "No stake backs the winning outcome. Use Refund after the dispute window.",
    RetryNotReady:
      "Wait 24 hours after the previous oracle request before retrying.",
    AskLimit: "The market has used its two oracle requests.",
    AnswerAlreadyDelivered:
      "An answer has already been delivered. Submit that answer.",
    EntryPaused: "The guardian has paused new markets and bets.",
    CreatorNotAllowed: "This wallet is not an approved creator.",
    InsufficientBounty:
      "The remaining bounty is too small for the oracle price.",
    EscalationUnavailable: "Escalation is unavailable for this market.",
    PoolCapExceeded: "This bet would exceed the market’s pool cap.",
    InvalidAttestation:
      "The answer does not satisfy this market’s attestation requirements.",
  };
  return reasons[name] || `Contract rejected this action: ${name}.`;
}

export function tokenSymbol(m: Pick<Market, "params">): TokenSymbol {
  return m.params.collateralId === 1 ? "WETH" : "IMD";
}
export function feeSplit(pool: bigint, c: CollateralConfig) {
  const creator = (pool * BigInt(c.creatorFeeBps)) / 10000n;
  const burn = (pool * BigInt(c.burnFeeBps)) / 10000n;
  const treasury = (pool * BigInt(c.treasuryFeeBps)) / 10000n;
  return {
    creator,
    burn,
    treasury,
    total: creator + burn + treasury,
    payout: pool - creator - burn - treasury,
  };
}
export function minimumBounty(price: bigint, reward: bigint): bigint {
  return 2n * price + 5n * reward;
}
export function utcTime(value: bigint): string {
  const d = new Date(Number(value) * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("hour")}:${get("minute")} UTC`;
}
export function marketMetadata(uri: string): {
  title?: string;
  targetTime?: bigint;
} {
  // Parse inline metadata as text only. Linked JSON is handled by the bounded metadata reader.
  try {
    let raw = uri;
    if (uri.startsWith("data:application/json;base64,"))
      raw = new TextDecoder().decode(
        Uint8Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0)),
      );
    else if (uri.startsWith("data:application/json,"))
      raw = decodeURIComponent(uri.slice(uri.indexOf(",") + 1));
    const obj = JSON.parse(raw);
    return {
      title:
        typeof (obj.title ?? obj.name) === "string"
          ? (obj.title ?? obj.name).slice(0, 500)
          : undefined,
      targetTime:
        typeof obj.targetTime === "number" &&
        Number.isSafeInteger(obj.targetTime) &&
        obj.targetTime > 0 &&
        obj.targetTime < 8640000000000
          ? BigInt(obj.targetTime)
          : undefined,
    };
  } catch {
    return {
      title:
        uri && !/^(https?:|ipfs:|data:)/i.test(uri)
          ? uri.slice(0, 500)
          : undefined,
    };
  }
}
export function proposalReason(
  m: Market,
  answer?: ChainEvent,
): string | undefined {
  if (!answer)
    return "No verified attestation is available. Inspect oracle evidence.";
  const expected =
    m.status === 1 ? m.escalationRequest : m.primaryRequests[m.asks - 1];
  if (
    !expected ||
    expected.toLowerCase() !== String(answer.args.intakeRequestId).toLowerCase()
  )
    return m.status === 1
      ? "Only this market’s requested escalation can replace the result."
      : "Only the market’s latest primary ask can be proposed. This answer is superseded.";
}
export function shareUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?${new URLSearchParams({ text, url })}`;
}

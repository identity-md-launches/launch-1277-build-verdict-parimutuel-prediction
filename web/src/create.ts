import { isAddress, pad, parseUnits, toHex, type Hex } from "viem";
import type { ChainConfig } from "./config";
import { composeBodies } from "./domain";
import type { Body, Params } from "./types";
export interface CreateInput {
  question: string;
  dataChainId: string;
  answerType: "bool" | "uint256" | "address[]" | "bytes32[]";
  fromBlock: string;
  toBlock: string;
  panelSize: string;
  quorum: string;
  evidence: string;
  toleranceBps: string;
  definitions: string;
  bounds: string;
  keys: string;
  closeAt: string;
  answerFrom: string;
  answerUntil: string;
  voidAfter: string;
  disputeHours: string;
  bounty: string;
  agentId: string;
}
export class FormError extends Error {
  constructor(
    public field: keyof CreateInput,
    message: string,
  ) {
    super(message);
  }
}
const fail = (field: keyof CreateInput, message: string): never => {
  throw new FormError(field, message);
};
export function buildMarket(
  input: CreateInput,
  config: ChainConfig,
  price: bigint,
  now: bigint,
) {
  function integer(
    field: keyof CreateInput,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
  ) {
    const text = input[field];
    const value = Number(text);
    if (
      !/^\d+$/.test(text) ||
      !Number.isSafeInteger(value) ||
      value < min ||
      value > max
    )
      return fail(field, `Enter a whole number from ${min} to ${max}.`);
    return value;
  }
  function date(field: keyof CreateInput) {
    const value = Date.parse(input[field]);
    if (!Number.isFinite(value))
      return fail(field, "Choose a valid local date and time.");
    return BigInt(Math.floor(value / 1000));
  }
  const question = input.question.trim();
  if (!question)
    fail("question", "Write a precise question for the panel to answer.");
  const chainId = integer("dataChainId", 1),
    fromBlock = integer("fromBlock"),
    toBlock = integer("toBlock");
  if (toBlock < fromBlock)
    fail("toBlock", "The last block must be at or after the first block.");
  const panelSize = integer("panelSize", 5, 32767),
    quorum = integer("quorum", 1, panelSize);
  const closeAt = date("closeAt"),
    answerFrom = date("answerFrom"),
    answerUntil = date("answerUntil"),
    voidAfter = date("voidAfter");
  if (closeAt <= now) fail("closeAt", "Betting must close in the future.");
  if (answerFrom < closeAt)
    fail("answerFrom", "Open the answer window at or after betting closes.");
  if (answerUntil <= answerFrom)
    fail("answerUntil", "End the answer window after it opens.");
  if (voidAfter <= answerUntil)
    fail("voidAfter", "Set the void deadline after the answer window ends.");
  const disputeWindow = integer("disputeHours", 1, 72) * 3600;
  if (!/^\d+(\.\d{1,18})?$/.test(input.bounty))
    fail("bounty", "Enter a positive IMD amount with up to 18 decimals.");
  const bounty = parseUnits(input.bounty, 18);
  if (bounty <= 0n || bounty / 2n < price)
    fail("bounty", "Fund at least two oracle requests at the current price.");
  if (!/^\d+$/.test(input.agentId))
    fail("agentId", "Enter a nonnegative whole agent ID. Use 0 for a person.");
  const agentId = BigInt(input.agentId);
  if (agentId >= 2n ** 256n) fail("agentId", "The agent ID must fit uint256.");
  const codes = { bool: 0, uint256: 3, "address[]": 4, "bytes32[]": 5 };
  const bounds: bigint[] = [];
  const keys: Hex[] = [];
  if (input.answerType === "uint256") {
    const items = input.bounds
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length < 1 || items.length > 7)
      fail("bounds", "Provide 1–7 strictly increasing positive bounds.");
    for (const item of items) {
      if (!/^\d+(\.\d{1,18})?$/.test(item))
        fail("bounds", "Use positive decimal bounds with up to 18 decimals.");
      const b = parseUnits(item, 18);
      if (b <= (bounds.at(-1) || 0n) || b >= 2n ** 256n)
        fail("bounds", "Bounds must be positive, increasing, and fit uint256.");
      bounds.push(b);
    }
  }
  if (input.answerType.endsWith("[]")) {
    const items = input.keys
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length < 1 || items.length > 7)
      fail("keys", "Provide 1–7 unique outcome keys.");
    for (const item of items) {
      if (input.answerType === "address[]") {
        if (!isAddress(item))
          fail("keys", "Each key must be a valid Ethereum address.");
        keys.push(pad(item.toLowerCase() as Hex, { size: 32 }));
      } else if (/^0x[0-9a-fA-F]{64}$/.test(item))
        keys.push(item.toLowerCase() as Hex);
      else {
        if (item.startsWith("0x") || new TextEncoder().encode(item).length > 32)
          fail(
            "keys",
            "Use a full bytes32 hex key or text of at most 32 UTF-8 bytes.",
          );
        keys.push(toHex(item, { size: 32 }));
      }
    }
    if (new Set(keys).size !== keys.length)
      fail("keys", "Each outcome key must be unique.");
  }
  let definitions: Record<string, unknown> | undefined;
  if (input.definitions.trim()) {
    try {
      const value = JSON.parse(input.definitions);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error();
      if (Object.keys(value).length) definitions = value;
    } catch {
      fail(
        "definitions",
        'Definitions must be a JSON object, for example {"metric":"definition"}.',
      );
    }
  }
  const body: Body = {
    v: 1,
    question,
    chainId,
    window: { fromBlock, toBlock },
    answerType: input.answerType,
    evidence: input.evidence,
    panelSize,
    quorum,
    validForSeconds: 86400,
    consumer: {
      chainId: config.chainId,
      verifyingContract: config.deployment!.oracle,
    },
  };
  if (input.toleranceBps !== "")
    body.toleranceBps = integer("toleranceBps", 0, 10000);
  if (definitions) body.definitions = definitions;
  const composed = composeBodies(body);
  if (
    new TextEncoder().encode(composed.primary).length > 16384 ||
    new TextEncoder().encode(composed.escalation).length > 16384
  )
    fail(
      "question",
      "The question bodies must each fit 16,384 bytes. Shorten the question or definitions.",
    );
  const params: Params = {
    questionHash: composed.questionHash,
    answerType: codes[input.answerType],
    dataChainId: BigInt(chainId),
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
    minPanelSize: panelSize,
    minAgreed: quorum,
    closeAt,
    answerFrom,
    answerUntil,
    disputeWindow,
    voidAfter,
    bounds,
    keys,
    bounty,
  };
  return {
    body,
    ...composed,
    params,
    agentId,
    args: [
      params,
      toHex(composed.primary),
      toHex(composed.escalation),
      "",
      agentId,
    ] as const,
  };
}
export function expectedBlockAtClose(
  head: bigint,
  headTime: bigint,
  close: bigint,
  seconds: number,
): bigint {
  return (
    head + BigInt(Math.max(0, Math.ceil(Number(close - headTime) / seconds)))
  );
}

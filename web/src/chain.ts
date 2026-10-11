import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  decodeEventLog,
  erc20Abi,
  keccak256,
  type Abi,
  type Address,
  type Hex,
  type Log,
} from "viem";
import marketsAbiJson from "./abi/VerdictMarkets.json";
import oracleAbiJson from "./abi/VerdictOracle.json";
import type { ChainConfig } from "./config";
import { claimable, parseBody, recoverAttestation } from "./domain";
import type {
  Attestation,
  ChainEvent,
  Market,
  MarketView,
  Position,
  Snapshot,
} from "./types";
export const marketsAbi = marketsAbiJson as Abi;
export const oracleAbi = oracleAbiJson as Abi;
export { erc20Abi };
export function walletChain(c: ChainConfig) {
  return defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: c.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: c.explorer } },
    testnet: c.testnet,
  });
}
const clients = new Map<number, ReturnType<typeof makeClient>>();
function makeClient(c: ChainConfig) {
  return createPublicClient({
    chain: walletChain(c),
    transport: fallback(
      c.rpcUrls.map((url) => http(url, { timeout: 12000, retryCount: 1 })),
      { rank: false, retryCount: 0 },
    ),
  });
}
export function clientFor(c: ChainConfig) {
  if (!clients.has(c.chainId)) clients.set(c.chainId, makeClient(c));
  return clients.get(c.chainId)!;
}
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const index = i++;
        result[index] = await task(items[index]);
      }
    }),
  );
  return result;
}
export function logRanges(
  from: bigint,
  to: bigint,
  size = 10000n,
): [bigint, bigint][] {
  if (size <= 0n || size > 10000n)
    throw Error("Log chunks must contain 1–10,000 blocks.");
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size)
    ranges.push([start, start + size - 1n > to ? to : start + size - 1n]);
  return ranges;
}
export function decodeLogs(
  logs: Pick<
    Log,
    | "address"
    | "data"
    | "topics"
    | "transactionHash"
    | "blockNumber"
    | "logIndex"
  >[],
  c: ChainConfig,
): ChainEvent[] {
  const result: ChainEvent[] = [];
  for (const log of logs) {
    if (!log.transactionHash || log.blockNumber == null || log.logIndex == null)
      continue;
    try {
      const decoded = decodeEventLog({
        abi:
          log.address.toLowerCase() === c.deployment!.oracle.toLowerCase()
            ? oracleAbi
            : marketsAbi,
        data: log.data,
        topics: log.topics,
      });
      result.push({
        name: decoded.eventName!,
        args: decoded.args as Record<string, any>,
        transactionHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
        logIndex: log.logIndex,
      });
    } catch {
      /* Only known ABI events are part of the application model. */
    }
  }
  return result;
}
const scanned = new Map<number, { block: bigint; events: ChainEvent[] }>();
const blockTimes = new Map<string, bigint>();
const verifiedChains = new Set<number>();
export async function verifyDeployment(c: ChainConfig): Promise<void> {
  if (verifiedChains.has(c.chainId)) return;
  const client = clientFor(c),
    d = c.deployment!;
  if ((await client.getChainId()) !== c.chainId)
    throw Error(
      "RPC chain ID does not match the deployment. Transactions are disabled.",
    );
  await Promise.all(
    (["markets", "oracle", "burnVault"] as const).map(async (key) => {
      const code = await client.getBytecode({ address: d[key] });
      if (!code || keccak256(code) !== d.codeHashes[key])
        throw Error(
          `${key} deployed code does not match the verified deployment. Transactions are disabled.`,
        );
    }),
  );
  for (const key of ["token", "intake"] as const)
    if (!(await client.getBytecode({ address: d[key] })))
      throw Error(`No deployed code at the configured ${key}.`);
  verifiedChains.add(c.chainId);
}
async function scan(
  c: ChainConfig,
  toBlock: bigint,
  progress: (s: string) => void,
) {
  const old = scanned.get(c.chainId),
    deploy = c.deployment!.block;
  const from =
    old && old.block <= toBlock
      ? old.block - 24n > deploy
        ? old.block - 24n
        : deploy
      : deploy;
  const logs: Log[] = [];
  const ranges = logRanges(from, toBlock);
  for (let i = 0; i < ranges.length; i++) {
    progress(`Reading chain history · ${i + 1} / ${ranges.length}`);
    // Fallback providers are attempted first. Split a refused range to support stricter RPC limits.
    const fetchRange = async (start: bigint, end: bigint): Promise<Log[]> => {
      try {
        return await clientFor(c).getLogs({
          address: [c.deployment!.markets, c.deployment!.oracle],
          fromBlock: start,
          toBlock: end,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const rangeRejected =
          /block range|too many results|response size|query returned|result set|limit.{0,40}blocks|maximum.{0,40}blocks|exceed.{0,40}blocks/i.test(
            message,
          );
        // Splitting an offline/timeout failure only multiplies the wait.
        if (!rangeRejected || end - start < 100n) throw e;
        const mid = (start + end) / 2n;
        return [
          ...(await fetchRange(start, mid)),
          ...(await fetchRange(mid + 1n, end)),
        ];
      }
    };
    logs.push(...(await fetchRange(...ranges[i])));
  }
  const events = [
    ...(old && old.block <= toBlock
      ? old.events.filter((e) => e.blockNumber < from)
      : []),
    ...decodeLogs(logs, c),
  ].sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
  );
  scanned.set(c.chainId, { block: toBlock, events });
  return events;
}
export async function readMarket<T>(
  c: ChainConfig,
  functionName: string,
  args: readonly unknown[] = [],
  blockNumber?: bigint,
): Promise<T> {
  return (await clientFor(c).readContract({
    address: c.deployment!.markets,
    abi: marketsAbi,
    functionName,
    args,
    blockNumber,
  })) as T;
}
export async function loadSnapshot(
  c: ChainConfig,
  progress: (s: string) => void,
): Promise<Snapshot> {
  progress("Connecting to the chain…");
  await verifyDeployment(c);
  const client = clientFor(c),
    d = c.deployment!,
    block = await client.getBlock();
  if (block.number < d.block)
    throw Error("RPC is behind this deployment. Try refreshing.");
  const events = await scan(c, block.number, progress);
  progress("Reading pools and settlement state…");
  const creations = events.filter((e) => e.name === "MarketCreated");
  const [markets, burned, cap, paused, allowlistOn, price, count] =
    await Promise.all([
      mapLimit(creations, 4, async (created) => {
        const id = created.args.id as bigint;
        const market = await readMarket<Market>(
          c,
          "getMarket",
          [id],
          block.number,
        );
        const pools = await mapLimit(
          Array.from({ length: market.outcomes }, (_, i) => i),
          4,
          (i) => readMarket<bigint>(c, "outcomePool", [id, i], block.number),
        );
        const body = parseBody(created.args.body),
          escalation =
            created.args.escalationBody === "0x"
              ? { raw: "" }
              : parseBody(created.args.escalationBody);
        const marketEvents = events.filter((e) => e.args.id === id);
        const requestIds = marketEvents
          .filter((e) => e.name === "OracleAsked")
          .map((e) => e.args.intakeRequestId);
        const answers = events.filter(
          (e) =>
            e.name === "Answered" &&
            requestIds.includes(e.args.intakeRequestId),
        );
        return {
          id,
          market,
          created,
          body: body.body,
          bodyError: body.error,
          rawBody: body.raw,
          escalationBody: escalation.body,
          rawEscalation: escalation.raw,
          pools,
          events: marketEvents,
          answers,
        } as MarketView;
      }),
      client.readContract({
        address: d.token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [d.burnVault],
        blockNumber: block.number,
      }),
      readMarket<bigint>(c, "maxPoolPerMarket", [], block.number),
      readMarket<boolean>(c, "paused", [], block.number),
      readMarket<boolean>(c, "allowlistOn", [], block.number),
      client.readContract({
        address: d.oracle,
        abi: oracleAbi,
        functionName: "price",
        blockNumber: block.number,
      }) as Promise<bigint>,
      readMarket<bigint>(c, "marketCount", [], block.number),
    ]);
  if (BigInt(markets.length) !== count)
    throw Error(
      "RPC returned incomplete market history. Refresh to retry with fallback providers.",
    );
  return {
    markets,
    events,
    block: block.number,
    timestamp: block.timestamp,
    loadedAt: Date.now(),
    burned,
    cap,
    paused,
    allowlistOn,
    price,
    verified: true,
  };
}
export async function eventTime(
  c: ChainConfig,
  e: ChainEvent,
): Promise<bigint> {
  const key = `${c.chainId}:${e.blockNumber}:${e.transactionHash}`;
  if (!blockTimes.has(key))
    blockTimes.set(
      key,
      (await clientFor(c).getBlock({ blockNumber: e.blockNumber })).timestamp,
    );
  return blockTimes.get(key)!;
}
export async function loadAttestation(
  c: ChainConfig,
  v: MarketView,
  e: ChainEvent,
): Promise<Attestation> {
  if (
    !v.events.some(
      (asked) =>
        asked.name === "OracleAsked" &&
        asked.args.intakeRequestId === e.args.intakeRequestId,
    )
  )
    throw Error("Answer is not linked to this market.");
  const tx = await clientFor(c).getTransaction({ hash: e.transactionHash });
  const receipt = await clientFor(c).getTransactionReceipt({
    hash: e.transactionHash,
  });
  if (
    receipt.status !== "success" ||
    !receipt.logs.some(
      (l) =>
        l.address.toLowerCase() === c.deployment!.oracle.toLowerCase() &&
        l.logIndex === e.logIndex,
    )
  )
    throw Error("Oracle event is not in a successful receipt.");
  return recoverAttestation(tx.input, e, [
    v.market.bodyHash,
    v.market.escalationBodyHash,
  ]);
}
export async function loadPositions(
  c: ChainConfig,
  snapshot: Snapshot,
  account: Address,
): Promise<Position[]> {
  return mapLimit(snapshot.markets, 3, async (v) => {
    const [total, claimed] = await Promise.all([
      readMarket<bigint>(c, "totalStake", [v.id, account], snapshot.block),
      readMarket<boolean>(c, "claimed", [v.id, account], snapshot.block),
    ]);
    // Every outcome is read, including losing positions and positions already claimed.
    const actualStakes = await mapLimit(
      Array.from({ length: v.pools.length }, (_, i) => i),
      4,
      (i) =>
        readMarket<bigint>(c, "stakes", [v.id, account, i], snapshot.block),
    );
    return {
      id: v.id,
      stakes: actualStakes,
      total,
      claimed,
      claimable: claimable(v.market, v.pools, {
        stakes: actualStakes,
        total,
        claimed,
      }),
    };
  });
}

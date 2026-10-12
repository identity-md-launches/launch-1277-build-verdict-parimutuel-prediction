import { claimable, tokenSymbol } from "./domain";
import { settlementAction, settlementActor } from "./settlement";
import type { ChainEvent, MarketView, TokenSymbol } from "./types";
export type Board = "Traders" | "Agents" | "Creators" | "Settlers";
export interface Rank {
  id: string;
  wallets: string[];
  net: bigint;
  volume: bigint;
  finalized: number;
  played: number;
  wins: number;
  created: number;
  fees: bigint;
  rewards: bigint;
  actions: number;
}
const inWindow = (e: ChainEvent, since: bigint) =>
  since === 0n || (e.timestamp !== undefined && e.timestamp >= since);
export function unattributedSettlements(markets: MarketView[], since = 0n) {
  return markets.reduce(
    (count, v) => count + v.events.filter((e) =>
      inWindow(e, since) && settlementAction(e) !== undefined &&
      !settlementActor(e, v.events),
    ).length,
    0,
  );
}
export function leaderboard(
  markets: MarketView[],
  board: Board,
  token: TokenSymbol,
  since = 0n,
): Rank[] {
  const ranks = new Map<string, Rank>();
  const row = (id: string, wallet: string) => {
    if (!ranks.has(id))
      ranks.set(id, {
        id,
        wallets: [],
        net: 0n,
        volume: 0n,
        finalized: 0,
        played: 0,
        wins: 0,
        created: 0,
        fees: 0n,
        rewards: 0n,
        actions: 0,
      });
    const r = ranks.get(id)!;
    if (!r.wallets.includes(wallet)) r.wallets.push(wallet);
    return r;
  };
  for (const v of markets) {
    if (board === "Settlers") {
      if (token !== "IMD") continue;
      for (const e of v.events) {
        if (!inWindow(e, since)) continue;
        if (e.name === "SettlerRewarded") {
          const address = e.args.settler.toLowerCase();
          row(address, address).rewards += e.args.amount;
        }
        const actor = settlementActor(e, v.events)?.toLowerCase();
        if (actor) row(actor, actor).actions++;
      }
      continue;
    }
    if (tokenSymbol(v.market) !== token) continue;
    if (board === "Creators") {
      const r = row(
        v.market.creator.toLowerCase(),
        v.market.creator.toLowerCase(),
      );
      if (inWindow(v.created, since)) r.created++;
      for (const e of v.events) {
        if (!inWindow(e, since)) continue;
        if (e.name === "BetPlaced") r.volume += e.args.amount;
        if (e.name === "Finalized") r.fees += e.args.creatorFee;
      }
      continue;
    }
    const settled = v.events.find((e) =>
      ["Finalized", "Voided"].includes(e.name),
    );
    if (!settled || !inWindow(settled, since)) continue;
    const wallets = new Map<
      string,
      {
        stakes: bigint[];
        total: bigint;
        agents: Map<string, { total: bigint; winning: bigint }>;
      }
    >();
    for (const bet of v.events.filter((e) => e.name === "BetPlaced")) {
      const address = bet.args.bettor.toLowerCase();
      if (!wallets.has(address))
        wallets.set(address, {
          stakes: v.pools.map(() => 0n),
          total: 0n,
          agents: new Map(),
        });
      const w = wallets.get(address)!;
      w.stakes[bet.args.outcome] += bet.args.amount;
      w.total += bet.args.amount;
      const id = String(bet.args.agentId);
      if (!w.agents.has(id)) w.agents.set(id, { total: 0n, winning: 0n });
      const a = w.agents.get(id)!;
      a.total += bet.args.amount;
      if (bet.args.outcome === v.market.outcome) a.winning += bet.args.amount;
    }
    const perMarket = new Map<
      string,
      { net: bigint; volume: bigint; winning: bigint }
    >();
    for (const [address, w] of wallets) {
      const claimed = v.events.find(
        (e) => e.name === "Claimed" && e.args.bettor.toLowerCase() === address,
      );
      const due =
        v.market.status === 3
          ? w.total
          : claimed
            ? (claimed.args.amount as bigint)
            : claimable(v.market, v.pools, { ...w, claimed: false });
      const add = (
        id: string,
        net: bigint,
        volume: bigint,
        winning: bigint,
      ) => {
        row(id, address);
        const a = perMarket.get(id) || { net: 0n, volume: 0n, winning: 0n };
        a.net += net;
        a.volume += volume;
        a.winning += winning;
        perMarket.set(id, a);
      };
      if (board === "Traders")
        add(
          address,
          v.market.status === 3 ? 0n : due - w.total,
          w.total,
          v.market.status === 2 ? w.stakes[v.market.outcome] : 0n,
        );
      else {
        // Attribute the wallet's payout to its winning agent-labelled stakes. Assign
        // integer rounding residue to the final winning label in stable ID order.
        const agents = [...w.agents].sort(([a], [b]) => a.localeCompare(b));
        let remainingDue = due,
          remainingStake = w.stakes[v.market.outcome];
        for (const [id, a] of agents) {
          const share =
            v.market.status === 3
              ? a.total
              : a.winning === 0n
                ? 0n
                : a.winning === remainingStake
                  ? remainingDue
                  : (due * a.winning) / w.stakes[v.market.outcome];
          if (v.market.status === 2) {
            remainingDue -= share;
            remainingStake -= a.winning;
          }
          add(
            id,
            v.market.status === 3 ? 0n : share - a.total,
            a.total,
            v.market.status === 2 ? a.winning : 0n,
          );
        }
      }
    }
    for (const [id, stats] of perMarket) {
      const r = ranks.get(id)!;
      r.played++;
      r.volume += stats.volume;
      r.net += stats.net;
      if (v.market.status === 2) {
        r.finalized++;
        if (stats.winning > 0n) r.wins++;
      }
    }
  }
  const metric =
    board === "Creators" ? "fees" : board === "Settlers" ? "rewards" : "net";
  return [...ranks.values()]
    .filter((r) =>
      board === "Traders" || board === "Agents"
        ? r.finalized >= 3
        : r.created || r.volume || r.fees || r.rewards || r.actions,
    )
    .sort((a, b) =>
      a[metric] > b[metric]
        ? -1
        : a[metric] < b[metric]
          ? 1
          : a.id.localeCompare(b.id),
    );
}

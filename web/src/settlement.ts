import { decodeFunctionData, type Abi, type Address, type Hex } from "viem";
import marketsAbi from "./abi/VerdictMarkets.json";
import type { ChainEvent } from "./types";

// These state-transition logs exist even when settlerReward is zero. Escalate
// emits OracleAsked too, but is not one of the four settlement actions.
export function settlementAction(e: ChainEvent): number | undefined {
  if (e.name === "OracleAsked" && e.args.escalation === false) return 0;
  if (e.name === "OutcomeProposed") return 1;
  if (e.name === "Finalized") return 2;
  if (e.name === "Voided") return 3;
}

export function settlementActor(
  e: ChainEvent,
  events: ChainEvent[],
): Address | undefined {
  const action = settlementAction(e);
  if (action === undefined) return;
  // Reward logs identify msg.sender even through a smart wallet or batcher.
  // Resolve/propose emit the reward after the transition, finalize/void before.
  const reward = events
    .filter((r) =>
      r.name === "SettlerRewarded" && r.args.id === e.args.id &&
      r.transactionHash === e.transactionHash && r.args.action === action &&
      (action < 2 ? r.logIndex > e.logIndex : r.logIndex < e.logIndex),
    )
    .sort((a, b) => Math.abs(a.logIndex - e.logIndex) - Math.abs(b.logIndex - e.logIndex))[0];
  return reward?.args.settler ?? e.settler;
}

export interface SettlementTransaction {
  hash: Hex;
  blockNumber: bigint | null;
  to: Address | null;
  from: Address;
  input: Hex;
}

export function directSettlementActor(
  e: ChainEvent,
  tx: SettlementTransaction,
  markets: Address,
): Address | undefined {
  const action = settlementAction(e);
  if (
    action === undefined || tx.hash !== e.transactionHash ||
    tx.blockNumber !== e.blockNumber ||
    tx.to?.toLowerCase() !== markets.toLowerCase()
  ) return;
  try {
    const call = decodeFunctionData({ abi: marketsAbi as Abi, data: tx.input });
    if (
      call.functionName === ["resolve", "propose", "finalize", "voidMarket"][action] &&
      call.args?.[0] === e.args.id
    ) return tx.from;
  } catch {
    // Do not label an outer transaction sender as an internal contract caller.
  }
}

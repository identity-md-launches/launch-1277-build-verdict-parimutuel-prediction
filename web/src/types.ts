import type { Address, Hex } from "viem";
export interface Params {
  questionHash: Hex;
  answerType: number;
  dataChainId: bigint;
  fromBlock: bigint;
  toBlock: bigint;
  minPanelSize: number;
  minAgreed: number;
  closeAt: bigint;
  answerFrom: bigint;
  answerUntil: bigint;
  disputeWindow: number;
  voidAfter: bigint;
  bounds: bigint[];
  keys: Hex[];
  bounty: bigint;
}
export interface Market {
  params: Params;
  creator: Address;
  bodyHash: Hex;
  escalationBodyHash: Hex;
  status: number;
  outcomes: number;
  outcome: number;
  asks: number;
  panelSize: number;
  escalationAsked: boolean;
  escalated: boolean;
  lastPrimaryAsk: bigint;
  disputeEnds: bigint;
  pool: bigint;
  bountyRemaining: bigint;
  oracleSpend: bigint;
  fees: bigint;
  returnedBounty: bigint;
  paidOut: bigint;
  refunded: bigint;
  remainingPayout: bigint;
  remainingWinningStake: bigint;
  primaryRequests: Hex[];
  escalationRequest: Hex;
  escalationAskedAt: bigint;
}
export interface Body {
  v: number;
  question: string;
  chainId: number;
  window: { fromBlock: number; toBlock: number };
  answerType: string;
  evidence: string;
  panelSize: number;
  quorum: number;
  validForSeconds: number;
  consumer: { chainId: number; verifyingContract: Address };
  toleranceBps?: number;
  definitions?: Record<string, unknown>;
}
// Event arguments are decoded against the checked, generated ABI at the chain boundary.
export interface ChainEvent {
  name: string;
  args: Record<string, any>;
  transactionHash: Hex;
  blockNumber: bigint;
  logIndex: number;
  timestamp?: bigint;
}
export interface Attestation {
  requestId: Hex;
  chainId: bigint;
  questionHash: Hex;
  answerType: number;
  answer: Hex;
  figure: bigint;
  fromBlock: bigint;
  toBlock: bigint;
  blockHash: Hex;
  panelJobId: Hex;
  panelSize: number;
  quorum: number;
  agreed: number;
  issuedAt: bigint;
  expiresAt: bigint;
}
export interface MarketView {
  id: bigint;
  market: Market;
  created: ChainEvent;
  body?: Body;
  bodyError?: string;
  rawBody: string;
  escalationBody?: Body;
  rawEscalation: string;
  pools: bigint[];
  events: ChainEvent[];
  answers: ChainEvent[];
}
export interface Snapshot {
  markets: MarketView[];
  events: ChainEvent[];
  block: bigint;
  timestamp: bigint;
  loadedAt: number;
  burned: bigint;
  cap: bigint;
  paused: boolean;
  allowlistOn: boolean;
  price: bigint;
  verified: boolean;
}
export interface Position {
  id: bigint;
  stakes: bigint[];
  total: bigint;
  claimed: boolean;
  claimable: bigint;
}
export type Status =
  | "Open"
  | "Closed"
  | "Asked"
  | "Answered"
  | "Provisional"
  | "Finalized"
  | "Voided";

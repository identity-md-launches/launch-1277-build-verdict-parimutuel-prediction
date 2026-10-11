import { useEffect, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { useData } from "./store";
import { useWallet } from "./wallet";
import {
  amount,
  countdown,
  errorMessage,
  marketStatus,
  outcomeLabels,
  units,
} from "./domain";
import type { MarketView, Status } from "./types";
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      aria-hidden="true"
    >
      <g fill="var(--accent)">
        <rect
          x="89"
          y="157"
          width="78.57"
          height="22"
          rx="11"
          transform="rotate(-135 100 168)"
        />
        <rect
          x="89"
          y="157"
          width="96.93"
          height="22"
          rx="11"
          transform="rotate(-49.76 100 168)"
        />
        <circle cx="167.18" cy="88.61" r="10" />
        <circle cx="183.98" cy="68.76" r="7" />
      </g>
      <circle cx="100" cy="168" r="15" fill="var(--text)" />
    </svg>
  );
}
export function External({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
      <span className="external-arrow" aria-hidden="true">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
export function TxLink({
  hash,
  children,
}: {
  hash?: Hex;
  children: ReactNode;
}) {
  const { config } = useData();
  return hash ? (
    <External href={`${config.explorer}/tx/${hash}`}>{children}</External>
  ) : (
    <>{children}</>
  );
}
export function Time({ value }: { value: bigint }) {
  const date = new Date(Number(value) * 1000);
  return (
    <time dateTime={date.toISOString()} title={date.toUTCString()}>
      {date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
}
export function Token({ value }: { value: bigint }) {
  const { config } = useData();
  return (
    <span
      title={`${units(value)} ${config.testnet ? "test IMD" : "IMD"}`}
      className="number"
    >
      {amount(value)} <span className="unit">IMD</span>
    </span>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <span aria-hidden="true" className="status-dot" />
      {status}
    </span>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        ↗
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function PageIntro({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
export function Odds({
  view,
  compact = false,
}: {
  view: MarketView;
  compact?: boolean;
}) {
  const labels = outcomeLabels(view.market.params),
    settled = view.market.status === 2;
  return (
    <div className={`outcomes ${compact ? "compact" : ""}`}>
      {labels.map((label, index) => {
        const percent = view.market.pool
          ? Number((view.pools[index] * 10000n) / view.market.pool) / 100
          : null;
        return (
          <div
            className={`outcome ${settled && index === view.market.outcome ? "winner" : ""}`}
            key={index}
          >
            <div className="outcome-top">
              <span className="outcome-label">
                {label}
                {settled && index === view.market.outcome && (
                  <span className="winner-label"> ✓ Winner</span>
                )}
              </span>
              <strong>
                {percent === null ? "—" : `${percent.toFixed(1)}%`}
              </strong>
            </div>
            <div className="odds-track" aria-hidden="true">
              <div style={{ width: `${percent || 0}%` }} />
            </div>
            <div className="outcome-foot">
              <Token value={view.pools[index]} />
              <span>pool share</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function MarketCard({ view }: { view: MarketView }) {
  const { now, data } = useData();
  const status = marketStatus(view.market, view.events, view.answers, now);
  return (
    <article className="market-card">
      <div className="card-meta">
        <span className="mono muted">Market #{view.id.toString()}</span>
        <StatusBadge status={status} />
      </div>
      <h3>
        <a href={`#/market/${view.id}`}>
          {view.body?.question || `Market #${view.id} · body unavailable`}
          <span className="card-arrow" aria-hidden="true">
            ↗
          </span>
        </a>
      </h3>
      <Odds view={view} compact />
      <div className="cap-line">
        <span>
          <Token value={view.market.pool} /> pooled
        </span>
        <span>Cap {data ? amount(data.cap) : "—"} IMD</span>
      </div>
      <progress
        aria-label="Total pool against market cap"
        max={100}
        value={
          data?.cap ? Number((view.market.pool * 10000n) / data.cap) / 100 : 0
        }
      />
      <div className="card-bottom">
        <span>
          {status === "Open"
            ? `Closes in ${countdown(view.market.params.closeAt, now)}`
            : status === "Provisional"
              ? `Dispute: ${countdown(view.market.disputeEnds, now)}`
              : status === "Voided"
                ? "Deposits refundable"
                : status === "Finalized"
                  ? `Result: ${outcomeLabels(view.market.params)[view.market.outcome]}`
                  : "Betting closed"}
        </span>
        <a href={`#/market/${view.id}`}>
          View market <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
export function DataBoundary({ children }: { children: ReactNode }) {
  const { data, loading, error, progress, refresh } = useData();
  if (!data)
    return error ? (
      <Empty
        title="Chain data is unavailable"
        action={
          <button onClick={() => void refresh()}>Retry connection</button>
        }
      >
        {error}
      </Empty>
    ) : (
      <div className="loading-state" role="status">
        <span className="loading-mark" aria-hidden="true" />
        <p>{loading ? progress : "Waiting for chain data…"}</p>
        <span className="small muted">
          Reading public contracts. No account needed.
        </span>
      </div>
    );
  return <>{children}</>;
}
export function TransactionNotice() {
  const wallet = useWallet();
  return wallet.message ? (
    <div className="notice transaction-notice" role="status">
      <strong>{wallet.actionLabel}</strong>
      <p>{wallet.message}</p>
      {wallet.tx && <TxLink hash={wallet.tx}>View transaction</TxLink>}
      {!wallet.pending && (
        <button className="text-button" onClick={wallet.dismissMessage}>
          Dismiss transaction message
        </button>
      )}
    </div>
  ) : null;
}
export function ActionButton({
  name,
  args,
  label,
  unavailable,
  className = "",
}: {
  name: string;
  args: readonly unknown[];
  label: string;
  unavailable?: string;
  className?: string;
}) {
  const { data, error } = useData(),
    wallet = useWallet();
  const [reason, setReason] = useState("Checking contract…"),
    [checking, setChecking] = useState(true);
  const key = JSON.stringify(args, (_, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  useEffect(() => {
    let live = true;
    if (!wallet.account || unavailable || error || !data?.verified) {
      setReason(
        unavailable ||
          error ||
          (!wallet.account
            ? "Connect a wallet to check this action."
            : "Wait for verified chain data."),
      );
      setChecking(false);
      return;
    }
    const run = async () => {
      setChecking(true);
      try {
        await wallet.simulate(name, args);
        if (live) setReason("");
      } catch (e) {
        if (live) setReason(errorMessage(e));
      } finally {
        if (live) setChecking(false);
      }
    };
    void run();
    const timer = setInterval(() => void run(), 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [wallet.account, key, name, data?.block, unavailable, error]);
  return (
    <div className={`contract-action ${className}`}>
      <button
        disabled={checking || !!reason || wallet.pending}
        onClick={() => {
          void wallet.send(name, args).catch(() => {});
        }}
      >
        {checking ? "Checking…" : label}
        <span aria-hidden="true">↗</span>
      </button>
      <p className="small muted">
        {reason ||
          (wallet.pending
            ? "Waiting for the current transaction."
            : "Simulation passed. Your wallet will ask you to confirm.")}
      </p>
    </div>
  );
}

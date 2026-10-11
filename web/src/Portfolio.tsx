import { useEffect, useState } from "react";
import {
  ActionButton,
  DataBoundary,
  Empty,
  PageIntro,
  StatusBadge,
  Token,
  TransactionNotice,
  TxLink,
} from "./components";
import { loadPositions } from "./chain";
import { errorMessage, marketStatus, outcomeLabels, short } from "./domain";
import { useData } from "./store";
import { useWallet } from "./wallet";
import type { Position } from "./types";
export function Portfolio() {
  const wallet = useWallet();
  const { config, data, now } = useData();
  const [positions, setPositions] = useState<Position[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setPositions([]);
    setError("");
    if (wallet.account && data) {
      setLoading(true);
      void loadPositions(config, data, wallet.account)
        .then((p) => {
          if (live) setPositions(p);
        })
        .catch((e) => {
          if (live) setError(errorMessage(e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }
    return () => {
      live = false;
    };
  }, [wallet.account, data?.block, config.chainId, revision]);
  const active = positions.filter((p) => p.total > 0n),
    total = active.reduce((s, p) => s + p.total, 0n),
    claimable = active.reduce((s, p) => s + p.claimable, 0n);
  const activity =
    data?.events
      .filter(
        (e) =>
          ["BetPlaced", "Claimed"].includes(e.name) &&
          e.args.bettor?.toLowerCase() === wallet.account?.toLowerCase(),
      )
      .reverse() || [];
  return (
    <>
      <PageIntro title="Your positions.">
        {wallet.account
          ? `Wallet ${short(wallet.account)} · stakes, payouts and refunds read directly from chain.`
          : "Connect a wallet to see your stakes, claimable winnings and refunds."}
      </PageIntro>
      {!wallet.account ? (
        <Empty
          title="Your wallet is your portfolio"
          action={
            <button className="primary" onClick={wallet.connect}>
              Connect wallet <span aria-hidden="true">↗</span>
            </button>
          }
        >
          No account or sign-up. Connect the wallet you used to bet, and we’ll
          read its positions from the contracts.
        </Empty>
      ) : (
        <DataBoundary>
          {loading ? (
            <p className="loading-state" role="status">
              Reading wallet stakes and claims…
            </p>
          ) : error ? (
            <Empty
              title="Could not read this portfolio"
              action={
                <button onClick={() => setRevision((n) => n + 1)}>
                  Retry portfolio
                </button>
              }
            >
              {error}
            </Empty>
          ) : (
            <>
              <div className="portfolio-stats">
                <div className="stat">
                  <span>Total staked · all time</span>
                  <strong>
                    <Token value={total} />
                  </strong>
                </div>
                <div className="stat">
                  <span>Claimable now</span>
                  <strong>
                    <Token value={claimable} />
                  </strong>
                </div>
                <div className="stat">
                  <span>Markets held</span>
                  <strong>{active.length}</strong>
                </div>
              </div>
              <section className="section">
                <h2>Positions</h2>
                {active.length ? (
                  <div className="positions">
                    {active.map((p) => {
                      const v = data!.markets.find((v) => v.id === p.id)!;
                      const labels = outcomeLabels(v.market.params);
                      return (
                        <article className="panel position" key={String(p.id)}>
                          <div className="section-head">
                            <a href={`#/market/${p.id}`}>
                              <h3>{v.body?.question || `Market #${p.id}`}</h3>
                            </a>
                            <StatusBadge
                              status={marketStatus(
                                v.market,
                                v.events,
                                v.answers,
                                now,
                              )}
                            />
                          </div>
                          <div className="position-stakes">
                            {p.stakes.map(
                              (stake, i) =>
                                stake > 0n && (
                                  <div key={i}>
                                    <span>{labels[i]}</span>
                                    <Token value={stake} />
                                  </div>
                                ),
                            )}
                          </div>
                          <div className="position-claim">
                            <div>
                              <span className="small muted">
                                {p.claimed
                                  ? "Already claimed"
                                  : v.market.status === 3
                                    ? "Refund available"
                                    : "Winnings available"}
                              </span>
                              <strong>
                                <Token value={p.claimable} />
                              </strong>
                            </div>
                            <ActionButton
                              name="claim"
                              args={[p.id]}
                              label={
                                v.market.status === 3
                                  ? "Claim refund"
                                  : "Claim winnings"
                              }
                            />
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <Empty
                    title="No positions yet"
                    action={
                      <a className="button" href="#/markets">
                        Explore markets
                      </a>
                    }
                  >
                    Bets placed by this wallet will appear here, including
                    settled positions.
                  </Empty>
                )}
              </section>
              <section className="section">
                <h2>Wallet history</h2>
                {activity.length ? (
                  <ul className="activity-list panel">
                    {activity.map((e) => (
                      <li key={`${e.transactionHash}:${e.logIndex}`}>
                        <div>
                          <TxLink hash={e.transactionHash}>
                            {e.name === "BetPlaced"
                              ? "Bet placed"
                              : e.args.refund
                                ? "Refund claimed"
                                : "Winnings claimed"}
                          </TxLink>
                          <p>
                            <a href={`#/market/${e.args.id}`}>
                              Market #{String(e.args.id)}
                            </a>{" "}
                            · Block {e.blockNumber.toLocaleString()}
                          </p>
                        </div>
                        <Token value={e.args.amount} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    No betting or claim events for this wallet.
                  </p>
                )}
              </section>
              <TransactionNotice />
            </>
          )}
        </DataBoundary>
      )}
    </>
  );
}

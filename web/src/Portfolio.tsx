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
import { clientFor, erc20Abi, loadPositions } from "./chain";
import {
  errorMessage,
  marketStatus,
  outcomeLabels,
  short,
  tokenSymbol,
  units,
} from "./domain";
import { useData } from "./store";
import { useWallet } from "./wallet";
import { parseUnits } from "viem";
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
  const active = positions.filter((p) => p.total > 0n);
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
              <WethBalance />
              {(["IMD", "WETH"] as const).map((token) => {
                const list = active.filter(
                  (p) =>
                    tokenSymbol(
                      data!.markets.find((v) => v.id === p.id)!.market,
                    ) === token,
                );
                return (
                  <section className="section" key={token}>
                    <h2>{token} positions</h2>
                    <div className="portfolio-stats">
                      <div className="stat">
                        <span>Total staked · all time</span>
                        <strong>
                          <Token
                            symbol={token}
                            value={list.reduce((sum, p) => sum + p.total, 0n)}
                          />
                        </strong>
                      </div>
                      <div className="stat">
                        <span>Claimable · winnings and refunds</span>
                        <strong>
                          <Token
                            symbol={token}
                            value={list.reduce(
                              (sum, p) => sum + p.claimable,
                              0n,
                            )}
                          />
                        </strong>
                      </div>
                      <div className="stat">
                        <span>Markets played</span>
                        <strong>{list.length}</strong>
                      </div>
                    </div>
                  </section>
                );
              })}
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
                              <h3>
                                {v.title ||
                                  v.body?.question ||
                                  `Market #${p.id}`}
                              </h3>
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
                                    <Token
                                      value={stake}
                                      symbol={tokenSymbol(v.market)}
                                    />
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
                                <Token
                                  value={p.claimable}
                                  symbol={tokenSymbol(v.market)}
                                />
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
                        <Token
                          value={e.args.amount}
                          symbol={tokenSymbol(
                            data!.markets.find((v) => v.id === e.args.id)!
                              .market,
                          )}
                        />
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

function WethBalance() {
  const wallet = useWallet(),
    { config, data, error: chainError } = useData();
  const [balance, setBalance] = useState<bigint>(),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setBalance(undefined);
    setError("");
    if (wallet.account)
      void clientFor(config)
        .readContract({
          address: config.deployment!.weth,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet.account],
        })
        .then((b) => {
          if (live) setBalance(b);
        })
        .catch((e) => {
          if (live) setError(errorMessage(e));
        });
    return () => {
      live = false;
    };
  }, [wallet.account, data?.block]);
  async function unwrap(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      if (!/^\d+(\.\d{1,18})?$/.test(value))
        throw Error("Enter a WETH amount with up to 18 decimals.");
      const amount = parseUnits(value, 18);
      if (amount <= 0n || balance === undefined || amount > balance)
        throw Error("Enter an amount within your WETH balance.");
      await wallet.send("withdraw", [amount]);
      setValue("");
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <section className="panel">
      <h2>WETH in your wallet</h2>
      <p>
        {balance === undefined ? (
          "Reading WETH balance…"
        ) : (
          <Token value={balance} symbol="WETH" />
        )}
      </p>
      <form onSubmit={unwrap} className="unwrap-form">
        <label htmlFor="unwrap-amount">
          Unwrap amount · WETH
          <input
            id="unwrap-amount"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={!!error}
            aria-describedby="unwrap-error"
          />
        </label>
        <button
          type="button"
          disabled={balance === undefined || wallet.pending}
          onClick={() => setValue(units(balance!))}
        >
          Use full balance
        </button>
        <button
          type="submit"
          disabled={wallet.pending || balance === undefined || !!chainError}
        >
          Unwrap
        </button>
      </form>
      <p className="small muted">
        WETH9.withdraw returns the same amount of ETH. You need ETH for gas;
        stakes inside markets cannot be unwrapped.
      </p>
      <p id="unwrap-error" role={error ? "alert" : undefined} className="error">
        {error}
      </p>
    </section>
  );
}

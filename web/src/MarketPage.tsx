import { useEffect, useMemo, useState } from "react";
import { parseUnits, type Hex } from "viem";
import {
  ActionButton,
  DataBoundary,
  Empty,
  External,
  Odds,
  StatusBadge,
  Time,
  Token,
  TransactionNotice,
  TxLink,
} from "./components";
import {
  clientFor,
  erc20Abi,
  eventTime,
  loadAttestation,
  mapLimit,
} from "./chain";
import { CHAINS, LINKS } from "./config";
import {
  amount,
  countdown,
  decodeAnswer,
  errorMessage,
  marketStatus,
  outcomeLabels,
  panelUUID,
  short,
  units,
} from "./domain";
import { useData } from "./store";
import { useWallet } from "./wallet";
import type { Attestation, ChainEvent, MarketView } from "./types";
interface AnswerRecord {
  event: ChainEvent;
  attestation?: Attestation;
  error?: string;
}
export function MarketPage({ id }: { id: string }) {
  const { data } = useData();
  const view = data?.markets.find((v) => String(v.id) === id);
  return (
    <DataBoundary>
      {view ? (
        <MarketDetails key={id} view={view} />
      ) : (
        <Empty
          title="Market not found"
          action={
            <a className="button" href="#/markets">
              Explore markets
            </a>
          }
        >
          This market ID is not in the verified chain history.
        </Empty>
      )}
    </DataBoundary>
  );
}
function MarketDetails({ view }: { view: MarketView }) {
  const { config, now, data } = useData();
  const wallet = useWallet();
  const [answers, setAnswers] = useState<AnswerRecord[]>([]),
    [answerLoading, setAnswerLoading] = useState(false),
    [selected, setSelected] = useState("");
  const [times, setTimes] = useState<Record<string, bigint>>({});
  const m = view.market,
    status = marketStatus(m, view.events, view.answers, now),
    labels = outcomeLabels(m.params);
  const eventKey = [...view.events, ...view.answers]
    .map((e) => `${e.transactionHash}:${e.logIndex}`)
    .join();
  useEffect(() => {
    let live = true;
    setAnswerLoading(true);
    void mapLimit([...view.answers].reverse(), 2, async (event) => {
      try {
        return {
          event,
          attestation: await loadAttestation(config, view, event),
        };
      } catch (e) {
        return { event, error: errorMessage(e) };
      }
    }).then((result) => {
      if (live) {
        setAnswers(result);
        setSelected((current) =>
          result.some((r) => r.event.transactionHash === current)
            ? current
            : result[0]?.event.transactionHash || "",
        );
        setAnswerLoading(false);
      }
    });
    void mapLimit([...view.events, ...view.answers], 4, async (event) => {
      try {
        return [event.transactionHash, await eventTime(config, event)] as const;
      } catch {
        return null;
      }
    }).then((entries) => {
      if (live) setTimes(Object.fromEntries(entries.filter((x) => x !== null)));
    });
    return () => {
      live = false;
    };
  }, [eventKey, config.chainId]);
  const chosen = answers.find((r) => r.event.transactionHash === selected),
    a = chosen?.attestation;
  const proposed = [...view.events]
    .reverse()
    .find((e) => e.name === "OutcomeProposed");
  const final = view.events.find((e) => e.name === "Finalized"),
    voided = view.events.find((e) => e.name === "Voided");
  const submitted = answers.find(
    (r) => r.event.args.requestId === proposed?.args.requestId,
  );
  const proof = submitted?.attestation || a;
  const timeline = useMemo(() => {
    const eventRow = (e: ChainEvent, title: string) => ({
      title,
      time: times[e.transactionHash],
      tx: e.transactionHash,
      detail: `Block ${e.blockNumber.toLocaleString()}`,
    });
    const rows: { title: string; time?: bigint; tx?: Hex; detail?: string }[] =
      [
        eventRow(view.created, "Created"),
        {
          title: "Betting closes",
          time: m.params.closeAt,
          tx: view.created.transactionHash,
          detail: "Deadline set at creation",
        },
      ];
    const middle = [
      ...view.events.filter((e) =>
        ["OracleAsked", "OutcomeProposed", "DisputeExtended"].includes(e.name),
      ),
      ...view.answers,
    ].sort(
      (x, y) =>
        Number(x.blockNumber - y.blockNumber) || x.logIndex - y.logIndex,
    );
    rows.push(
      ...middle.map((e) =>
        eventRow(
          e,
          e.name === "OracleAsked"
            ? e.args.escalation
              ? "Escalation asked"
              : "Oracle asked"
            : e.name === "Answered"
              ? "Answer delivered"
              : e.name === "DisputeExtended"
                ? "Dispute window extended"
                : e.args.escalation
                  ? "Replacement proposed"
                  : "Proposed",
        ),
      ),
    );
    if (!middle.some((e) => e.name === "OracleAsked"))
      rows.push({
        title: "Oracle asked",
        detail: voided ? "Not requested" : "Awaiting request",
      });
    if (!view.answers.length)
      rows.push({
        title: "Answer delivered",
        detail: voided ? "No answer delivered" : "Awaiting oracle",
      });
    if (!proposed)
      rows.push({
        title: "Proposed",
        detail: voided ? "No proposal" : "Awaiting proposal",
      });
    const endEvent = [...view.events]
      .reverse()
      .find(
        (e) => e.name === "OutcomeProposed" || e.name === "DisputeExtended",
      );
    rows.push({
      title: "Dispute window ends",
      time: m.disputeEnds || undefined,
      tx: endEvent?.transactionHash,
      detail: endEvent
        ? "Deadline set by this transaction"
        : "Starts after a proposal",
    });
    rows.push(
      final
        ? eventRow(final, "Final")
        : voided
          ? eventRow(voided, "Refunds enabled")
          : { title: "Final or refunded", detail: "Awaiting settlement" },
    );
    return rows;
  }, [eventKey, times]);
  return (
    <>
      <div className="breadcrumb">
        <a href="#/markets">Markets</a>
        <span aria-hidden="true">/</span>
        <span>#{view.id.toString()}</span>
      </div>
      <div className="market-heading">
        <div className="card-meta">
          <StatusBadge status={status} />
          <span className="mono muted">
            Market #{String(view.id)} ·{" "}
            {view.body?.answerType || "Unknown type"}
          </span>
        </div>
        <h1>{view.body?.question || `Market #${view.id}`}</h1>
        <div className="market-byline">
          <span>
            Created by{" "}
            <External href={`${config.explorer}/address/${m.creator}`}>
              {short(m.creator)}
            </External>
          </span>
          <span>
            Agent ID {String(view.created.args.agentId)}
            {view.created.args.agentId === 0n ? " · Person" : ""}
          </span>
          <span>
            Closes <Time value={m.params.closeAt} />
          </span>
        </div>
      </div>
      {view.bodyError && (
        <div className="notice error" role="alert">
          {view.bodyError}
        </div>
      )}
      {status === "Provisional" && (
        <div className="notice">
          Provisional result: <strong>{labels[m.outcome]}</strong>. Dispute
          window{" "}
          {now < m.disputeEnds
            ? `ends in ${countdown(m.disputeEnds, now)}`
            : "has ended; awaiting finalization"}
          .
        </div>
      )}
      {status === "Finalized" && (
        <div className="result-banner">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Final verdict: {labels[m.outcome]}</strong>
            <p>
              Settlement is complete. Winning wallets can claim their share.
            </p>
          </div>
          <TxLink hash={final?.transactionHash}>Verify settlement</TxLink>
        </div>
      )}
      {status === "Voided" && (
        <div className="notice">
          <strong>Market voided.</strong> Bettors can claim their credited
          deposits in full. No settlement fees apply.
        </div>
      )}
      <div className="market-layout">
        <div className="market-main">
          <section className="panel">
            <div className="section-head">
              <h2>The pool</h2>
              <Token value={m.pool} />
            </div>
            <Odds view={view} />
            <div className="cap-line">
              <span>Market capacity</span>
              <span>
                {amount(m.pool)} / {data ? amount(data.cap) : "—"} IMD
              </span>
            </div>
            <progress
              value={data?.cap ? Number((m.pool * 10000n) / data.cap) / 100 : 0}
              max={100}
              aria-label="Total pool against cap"
            />
            <p className="small muted">
              Pool share shows implied odds before fees. Final payouts depend on
              all bets received.
            </p>
            {m.params.answerType === 3 && (
              <p className="small">
                Bucket bounds use 18-decimal units. Values on a boundary belong
                to the higher bucket.
              </p>
            )}
            {[4, 5].includes(m.params.answerType) && (
              <p className="small">
                The first item in the oracle’s list selects the outcome. An
                empty list or an unlisted first item means “None of these”.
              </p>
            )}
          </section>
          <section className="panel">
            <h2>Settlement timeline</h2>
            <ol className="timeline">
              {timeline.map((row, i) => (
                <li
                  className={row.tx ? "completed" : "pending"}
                  key={`${row.title}-${i}`}
                >
                  <span className="timeline-point" aria-hidden="true" />
                  <div>
                    <strong>
                      <TxLink hash={row.tx}>{row.title}</TxLink>
                    </strong>
                    <p>{row.time ? <Time value={row.time} /> : row.detail}</p>
                    {row.time && row.detail && (
                      <span className="small muted">{row.detail}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p className="small muted">
              Scheduled deadlines link to the transaction that set them. Times
              use your timezone; hover for UTC.
            </p>
          </section>
          <section className="panel" id="oracle-evidence">
            <div className="section-head">
              <h2>Oracle evidence</h2>
              {a && <span className="verification-badge">✓ Hash verified</span>}
            </div>
            {answerLoading ? (
              <p role="status">
                Recovering the attestation from transaction input…
              </p>
            ) : !answers.length ? (
              <p className="muted">
                No matched oracle answer has been delivered for this market.
              </p>
            ) : (
              <>
                {answers.length > 1 && (
                  <label>
                    Delivered answer
                    <select
                      value={selected}
                      onChange={(e) => setSelected(e.target.value)}
                    >
                      {answers.map((r) => (
                        <option
                          value={r.event.transactionHash}
                          key={r.event.transactionHash}
                        >
                          Request {short(r.event.args.requestId)} · block{" "}
                          {String(r.event.blockNumber)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {chosen?.error && (
                  <div className="notice error">
                    <p>Could not verify this attestation: {chosen.error}</p>
                    <External
                      href={`${LINKS.jobs}${panelUUID(chosen.event.args.requestId)}`}
                    >
                      Open request in IMD explorer
                    </External>
                  </div>
                )}
                {a && (
                  <>
                    <dl className="evidence-grid">
                      <div>
                        <dt>Answer</dt>
                        <dd>{decodeAnswer(a)}</dd>
                      </div>
                      <div>
                        <dt>Figure</dt>
                        <dd title={a.figure.toString()}>
                          {a.figure.toLocaleString()}{" "}
                          <span className="small muted">
                            (raw oracle figure)
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>Panel size</dt>
                        <dd>{a.panelSize} agents</dd>
                      </div>
                      <div>
                        <dt>Agreed / quorum</dt>
                        <dd>
                          {a.agreed} / {a.quorum}
                        </dd>
                      </div>
                      <div>
                        <dt>Data chain</dt>
                        <dd>
                          {CHAINS[Number(a.chainId)]?.name ||
                            `Chain ${a.chainId}`}{" "}
                          · {String(a.chainId)}
                        </dd>
                      </div>
                      <div>
                        <dt>Block window</dt>
                        <dd>
                          {a.fromBlock.toLocaleString()}–
                          {a.toBlock.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Issued at</dt>
                        <dd>
                          <Time value={a.issuedAt} />
                        </dd>
                      </div>
                      <div>
                        <dt>Expires at</dt>
                        <dd>
                          <Time value={a.expiresAt} />
                        </dd>
                      </div>
                    </dl>
                    <div className="evidence-links">
                      <External
                        href={`${LINKS.jobs}${panelUUID(a.panelJobId)}`}
                      >
                        Read the panel’s work
                      </External>
                      <TxLink hash={chosen!.event.transactionHash}>
                        Delivery transaction
                      </TxLink>
                    </div>
                    <details>
                      <summary>Attestation hashes and raw answer</summary>
                      <dl className="raw-data">
                        <dt>Attestation hash</dt>
                        <dd>
                          <code>{chosen!.event.args.attHash}</code>
                        </dd>
                        <dt>Block hash</dt>
                        <dd>
                          <code>{a.blockHash}</code>
                        </dd>
                        <dt>Raw answer</dt>
                        <dd>
                          <code>{a.answer}</code>
                        </dd>
                        <dt>Panel job ID</dt>
                        <dd>
                          <code>{panelUUID(a.panelJobId)}</code>
                        </dd>
                      </dl>
                    </details>
                    <p className="small muted">
                      The attestation was decoded from Intake.complete calldata
                      and matched to the oracle’s Answered hash. Delivery checks
                      freshness; an authenticated delivered answer remains
                      readable after expiry.
                    </p>
                  </>
                )}
              </>
            )}
          </section>
          <section className="panel">
            <h2>Question specification</h2>
            <dl className="evidence-grid">
              <div>
                <dt>Answer type</dt>
                <dd>{view.body?.answerType || m.params.answerType}</dd>
              </div>
              <div>
                <dt>Requested panel / quorum</dt>
                <dd>
                  {view.body?.panelSize ?? m.params.minPanelSize} /{" "}
                  {view.body?.quorum ?? m.params.minAgreed}
                </dd>
              </div>
              <div>
                <dt>Data chain</dt>
                <dd>{view.body?.chainId ?? String(m.params.dataChainId)}</dd>
              </div>
              <div>
                <dt>Block window</dt>
                <dd>
                  {String(m.params.fromBlock)}–{String(m.params.toBlock)}
                </dd>
              </div>
              <div>
                <dt>Answer window opens</dt>
                <dd>
                  <Time value={m.params.answerFrom} />
                </dd>
              </div>
              <div>
                <dt>Answer window closes</dt>
                <dd>
                  <Time value={m.params.answerUntil} />
                </dd>
              </div>
              <div>
                <dt>Void deadline</dt>
                <dd>
                  <Time value={m.params.voidAfter} />
                </dd>
              </div>
              <div>
                <dt>Bounty remaining</dt>
                <dd>
                  <Token value={m.bountyRemaining} />
                </dd>
              </div>
            </dl>
            <details>
              <summary>Primary body · raw JSON and hash</summary>
              <code className="hash-line">Body hash: {m.bodyHash}</code>
              <pre tabIndex={0} aria-label="Primary oracle body JSON">
                {view.rawBody}
              </pre>
            </details>
            <details>
              <summary>Escalation body · raw JSON and hash</summary>
              <code className="hash-line">
                Body hash: {m.escalationBodyHash}
              </code>
              <pre tabIndex={0} aria-label="Escalation oracle body JSON">
                {view.rawEscalation || "No escalation body was committed."}
              </pre>
            </details>
            <details>
              <summary>Question hash and creator</summary>
              <dl className="raw-data">
                <dt>Question hash</dt>
                <dd>
                  <code>{m.params.questionHash}</code>
                </dd>
                <dt>Creator</dt>
                <dd>
                  <External href={`${config.explorer}/address/${m.creator}`}>
                    <code>{m.creator}</code>
                  </External>
                </dd>
                <dt>Agent ID</dt>
                <dd>{String(view.created.args.agentId)}</dd>
              </dl>
            </details>
          </section>
          {final && (
            <section className="panel">
              <h2>Final fee split</h2>
              <p className="muted">
                Actual transfers recorded in the Finalized event.
              </p>
              <dl className="fee-grid">
                <div>
                  <dt>Creator · 1%</dt>
                  <dd>
                    <Token value={final.args.creatorFee} />
                  </dd>
                </div>
                <div>
                  <dt>Treasury · 0.5%</dt>
                  <dd>
                    <Token value={final.args.treasuryFee} />
                  </dd>
                </div>
                <div>
                  <dt>Burned · 0.5%</dt>
                  <dd>
                    <Token value={final.args.burnFee} />
                  </dd>
                </div>
              </dl>
              <TxLink hash={final.transactionHash}>Verify fee transfers</TxLink>
            </section>
          )}
          <section className="panel">
            <div className="section-head">
              <h2>Bet activity</h2>
              <span className="mono muted">
                {view.events.filter((e) => e.name === "BetPlaced").length} bets
              </span>
            </div>
            {view.events.filter((e) => e.name === "BetPlaced").length ? (
              <ul className="activity-list">
                {view.events
                  .filter((e) => e.name === "BetPlaced")
                  .reverse()
                  .map((e) => (
                    <li key={`${e.transactionHash}:${e.logIndex}`}>
                      <div>
                        <External
                          href={`${config.explorer}/address/${e.args.bettor}`}
                        >
                          {short(e.args.bettor)}
                        </External>
                        <p>
                          Backed <strong>{labels[e.args.outcome]}</strong> ·
                          Agent {String(e.args.agentId)}
                        </p>
                      </div>
                      <div>
                        <Token value={e.args.amount} />
                        <p>
                          <TxLink hash={e.transactionHash}>
                            {times[e.transactionHash] ? (
                              <Time value={times[e.transactionHash]} />
                            ) : (
                              `Block ${e.blockNumber}`
                            )}
                          </TxLink>
                        </p>
                      </div>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted">No bets have been placed.</p>
            )}
          </section>
        </div>
        <aside className="market-sidebar">
          <BetPanel view={view} />
          <section className="panel settlement-actions">
            <h2>Move it forward</h2>
            <p className="small muted">
              Anyone can advance settlement. Each action is simulated for your
              wallet. Refund enables deposit claims; Claim transfers your payout
              or refund.
            </p>
            {!wallet.account && (
              <button onClick={wallet.connect}>
                Connect wallet to check actions
              </button>
            )}
            <ActionButton
              name="resolve"
              args={[view.id, view.created.args.body]}
              label="Request answer"
            />
            <ActionButton
              name="escalate"
              args={[view.id, view.created.args.escalationBody]}
              label="Escalate"
            />
            <ActionButton
              name="propose"
              args={a ? [view.id, a] : []}
              label="Submit answer"
              unavailable={
                a
                  ? undefined
                  : answerLoading
                    ? "Reading the delivered attestation…"
                    : "No verified attestation is available. Inspect oracle evidence."
              }
            />
            <ActionButton name="finalize" args={[view.id]} label="Finalize" />
            <ActionButton name="voidMarket" args={[view.id]} label="Refund" />
            <ActionButton name="claim" args={[view.id]} label="Claim" />
            {proof && (
              <External href={`${LINKS.jobs}${panelUUID(proof.panelJobId)}`}>
                IMD panel evidence
              </External>
            )}
            <TransactionNotice />
          </section>
        </aside>
      </div>
    </>
  );
}
function BetPanel({ view }: { view: MarketView }) {
  const wallet = useWallet();
  const { config, data, now, error } = useData();
  const [outcome, setOutcome] = useState(1),
    [value, setValue] = useState(""),
    [balance, setBalance] = useState<bigint>(),
    [allowance, setAllowance] = useState<bigint>(),
    [issue, setIssue] = useState("");
  useEffect(() => {
    let live = true;
    setBalance(undefined);
    setAllowance(undefined);
    if (wallet.account)
      void Promise.all([
        clientFor(config).readContract({
          address: config.deployment!.token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet.account],
        }),
        clientFor(config).readContract({
          address: config.deployment!.token,
          abi: erc20Abi,
          functionName: "allowance",
          args: [wallet.account, config.deployment!.markets],
        }),
      ])
        .then(([b, a]) => {
          if (live) {
            setBalance(b);
            setAllowance(a);
          }
        })
        .catch((e) => {
          if (live) setIssue(errorMessage(e));
        });
    return () => {
      live = false;
    };
  }, [wallet.account, config.chainId, data?.block]);
  const labels = outcomeLabels(view.market.params),
    open = marketStatus(view.market, view.events, view.answers, now) === "Open";
  let stake = 0n;
  if (/^\d+(\.\d{0,18})?$/.test(value))
    try {
      stake = parseUnits(value, 18);
    } catch {}
  const poolAfter = view.market.pool + stake,
    selectedPool = (view.pools[outcome] || 0n) + stake;
  const projected =
    selectedPool && stake
      ? (stake *
          (poolAfter -
            (poolAfter * 100n) / 10000n -
            2n * ((poolAfter * 50n) / 10000n))) /
        selectedPool
      : 0n;
  const limitError =
    stake && data && poolAfter > data.cap
      ? "This amount exceeds the remaining pool capacity."
      : balance !== undefined && stake > balance
        ? `This amount exceeds your ${config.testnet ? "test IMD" : "IMD"} balance.`
        : "";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setIssue("");
    if (!wallet.account) {
      wallet.connect();
      return;
    }
    if (!stake || limitError) {
      setIssue(
        limitError || "Enter a positive amount with at most 18 decimals.",
      );
      document.getElementById("bet-amount")?.focus();
      return;
    }
    try {
      await wallet.send("bet", [view.id, outcome, stake, 0n], stake);
      setValue("");
    } catch (e) {
      setIssue(errorMessage(e));
    }
  }
  return (
    <section className="panel bet-panel">
      <h2>{open ? "Take a position" : "Betting has closed"}</h2>
      {open ? (
        <>
          <p className="small muted">
            Choose an outcome and back it with{" "}
            {config.testnet ? "test IMD" : "IMD"}.
          </p>
          <form onSubmit={submit}>
            <fieldset>
              <legend>Outcome</legend>
              <div className="bet-outcomes">
                {labels.map((label, i) => (
                  <label className={outcome === i ? "selected" : ""} key={i}>
                    <input
                      type="radio"
                      name="outcome"
                      checked={outcome === i}
                      onChange={() => setOutcome(i)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label htmlFor="bet-amount">
              Amount · {config.testnet ? "test IMD" : "IMD"}
            </label>
            <input
              id="bet-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setIssue("");
              }}
              aria-invalid={!!issue || !!limitError}
              aria-describedby="bet-help bet-error"
            />
            <div className="amount-presets">
              {["1", "5", "10"].map((n) => (
                <button type="button" key={n} onClick={() => setValue(n)}>
                  {n} IMD
                </button>
              ))}
            </div>
            <p className="small muted" id="bet-help">
              Balance:{" "}
              {balance === undefined
                ? "Connect to read"
                : `${units(balance)} IMD`}
              . Bets cannot be withdrawn.
            </p>
            <div className="bet-estimate">
              <span>If this outcome wins</span>
              <strong>
                <Token value={projected} />
              </strong>
              <span className="small muted">
                Estimate at this pool, after 2% fees. Includes your stake; final
                payout can change.
              </span>
            </div>
            <p
              id="bet-error"
              role={issue || limitError ? "alert" : undefined}
              className="error small"
            >
              {issue || limitError}
            </p>
            <button
              className="primary"
              type="submit"
              disabled={wallet.pending || !!error || !!data?.paused}
            >
              {wallet.pending
                ? "Waiting for wallet…"
                : !wallet.account
                  ? "Connect wallet to bet"
                  : allowance !== undefined && allowance < stake
                    ? "Approve exact amount & bet"
                    : "Place bet"}
              <span aria-hidden="true">↗</span>
            </button>
            <p className="small muted">
              {data?.paused
                ? "The guardian has paused new bets."
                : "The wallet will show approval and bet as separate transactions when an allowance is needed."}
            </p>
          </form>
        </>
      ) : (
        <>
          <p className="muted">
            The pool is locked. Follow the evidence and settlement below.
          </p>
          <div className="closed-pool">
            <span className="small muted">Total pool</span>
            <strong>
              <Token value={view.market.pool} />
            </strong>
          </div>
          <a href="#/markets" className="button">
            Explore other markets <span aria-hidden="true">↗</span>
          </a>
        </>
      )}
    </section>
  );
}

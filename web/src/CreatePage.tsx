import { useEffect, useState } from "react";
import {
  DataBoundary,
  Empty,
  PageIntro,
  TransactionNotice,
} from "./components";
import { clientFor, readMarket } from "./chain";
import { CHAINS } from "./config";
import {
  buildMarket,
  expectedBlockAtClose,
  FormError,
  type CreateInput,
} from "./create";
import { errorMessage, outcomeLabels, units } from "./domain";
import { useData } from "./store";
import { useWallet } from "./wallet";
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
function defaults(chainId: number): CreateInput {
  const start = Date.now() + 86400000;
  return {
    question: "",
    dataChainId: String(chainId),
    answerType: "bool",
    fromBlock: "",
    toBlock: "",
    panelSize: "5",
    quorum: "4",
    evidence: "chain",
    toleranceBps: "",
    definitions: "",
    bounds: "",
    keys: "",
    closeAt: localDate(new Date(start)),
    answerFrom: localDate(new Date(start + 3600000)),
    answerUntil: localDate(new Date(start + 172800000)),
    voidAfter: localDate(new Date(start + 259200000)),
    disputeHours: "24",
    bounty: "",
    agentId: "0",
  };
}
export function CreatePage() {
  const { config, data } = useData(),
    wallet = useWallet();
  const [allowed, setAllowed] = useState<boolean>(),
    [accessError, setAccessError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setAllowed(undefined);
    setAccessError("");
    if (wallet.account && data) {
      if (!data.allowlistOn) setAllowed(true);
      else
        void readMarket<boolean>(
          config,
          "allowedCreators",
          [wallet.account],
          data.block,
        )
          .then((value) => {
            if (live) setAllowed(value);
          })
          .catch((e) => {
            if (live) setAccessError(errorMessage(e));
          });
    }
    return () => {
      live = false;
    };
  }, [wallet.account, data?.block, config.chainId, revision]);
  return (
    <>
      <PageIntro title="Put a question on chain.">
        Define the outcomes, fund the oracle, and let the evidence decide.
      </PageIntro>
      {!wallet.account ? (
        <Empty
          title="Creators start with a wallet"
          action={
            <button className="primary" onClick={wallet.connect}>
              Connect wallet
            </button>
          }
        >
          Market creation is restricted to approved creators while the allowlist
          is enabled. Connect to check your access.
        </Empty>
      ) : (
        <DataBoundary>
          {accessError ? (
            <Empty
              title="Could not check creator access"
              action={
                <button onClick={() => setRevision((n) => n + 1)}>
                  Retry access check
                </button>
              }
            >
              {accessError}
            </Empty>
          ) : allowed === undefined ? (
            <p className="loading-state" role="status">
              Checking the on-chain creator allowlist…
            </p>
          ) : !allowed ? (
            <Empty
              title="This wallet isn’t an approved creator"
              action={
                <a href="#/markets" className="button">
                  Explore markets
                </a>
              }
            >
              Only the guardian can approve creators while the allowlist is
              enabled. You can still bet on open markets and advance settlement.
            </Empty>
          ) : (
            <CreatorForm key={config.chainId} />
          )}
        </DataBoundary>
      )}
    </>
  );
}
function CreatorForm() {
  const { config, data, now, error: readError } = useData();
  const wallet = useWallet();
  const [input, setInput] = useState<CreateInput>(() =>
    defaults(config.chainId),
  );
  const [issue, setIssue] = useState(""),
    [invalid, setInvalid] = useState(""),
    [review, setReview] = useState<ReturnType<typeof buildMarket>>();
  const [expected, setExpected] = useState<bigint>(),
    [estimateError, setEstimateError] = useState("");
  useEffect(() => {
    if (data && !input.bounty)
      setInput((i) => ({ ...i, bounty: units(data.price * 2n) }));
  }, [data?.price]);
  useEffect(() => {
    let live = true;
    setExpected(undefined);
    setEstimateError("");
    const chain = CHAINS[Number(input.dataChainId)];
    if (!chain) {
      setEstimateError(
        "No RPC configured for this data chain. Add it to the chain configuration to estimate the closing block.",
      );
      return;
    }
    const time = Date.parse(input.closeAt);
    if (!Number.isFinite(time)) return;
    void clientFor(chain)
      .getBlock()
      .then((block) => {
        if (live)
          setExpected(
            expectedBlockAtClose(
              block.number,
              block.timestamp,
              BigInt(Math.floor(time / 1000)),
              chain.expectedBlockSeconds,
            ),
          );
      })
      .catch((e) => {
        if (live)
          setEstimateError(
            `Could not estimate the closing block: ${errorMessage(e)}`,
          );
      });
    return () => {
      live = false;
    };
  }, [input.dataChainId, input.closeAt, data?.block]);
  function update(field: keyof CreateInput, value: string) {
    setInput((i) => ({ ...i, [field]: value }));
    setReview(undefined);
    setIssue("");
    setInvalid("");
  }
  function field(
    name: keyof CreateInput,
    label: string,
    type = "text",
    hint?: string,
  ) {
    return (
      <label htmlFor={`create-${name}`}>
        {label}
        <input
          id={`create-${name}`}
          name={name}
          type={type}
          value={input[name]}
          onChange={(e) => update(name, e.target.value)}
          aria-invalid={invalid === name}
          aria-describedby={
            invalid === name
              ? "create-error"
              : hint
                ? `hint-${name}`
                : undefined
          }
          {...([
            "fromBlock",
            "toBlock",
            "panelSize",
            "quorum",
            "disputeHours",
            "agentId",
            "toleranceBps",
          ].includes(name)
            ? { inputMode: "numeric" as const }
            : name === "bounty"
              ? { inputMode: "decimal" as const }
              : {})}
        />
        {hint && (
          <span className="field-hint" id={`hint-${name}`}>
            {hint}
          </span>
        )}
      </label>
    );
  }
  const warn =
    expected !== undefined &&
    /^\d+$/.test(input.fromBlock) &&
    BigInt(input.fromBlock) <= expected;
  function preview(e: React.FormEvent) {
    e.preventDefault();
    setIssue("");
    setInvalid("");
    try {
      setReview(buildMarket(input, config, data!.price, now));
      requestAnimationFrame(() =>
        document.getElementById("create-review")?.focus(),
      );
    } catch (e) {
      setIssue(errorMessage(e));
      if (e instanceof FormError) {
        setInvalid(e.field);
        document.getElementById(`create-${e.field}`)?.focus();
      }
    }
  }
  async function create() {
    if (!review) return;
    try {
      const fresh = buildMarket(input, config, data!.price, now);
      await wallet.send("createMarket", fresh.args, fresh.params.bounty);
      setReview(undefined);
      setIssue("");
      location.hash = "/markets";
    } catch (e) {
      setIssue(errorMessage(e));
    }
  }
  return (
    <div className="create-layout">
      <form onSubmit={preview} className="create-form" noValidate>
        <section className="panel">
          <h2>1. The question</h2>
          <label htmlFor="create-question">
            Question
            <textarea
              id="create-question"
              name="question"
              rows={4}
              value={input.question}
              onChange={(e) => update("question", e.target.value)}
              placeholder="Ask a precise question the panel can answer from evidence."
              aria-invalid={invalid === "question"}
              aria-describedby={
                invalid === "question" ? "create-error" : undefined
              }
            />
          </label>
          <div className="form-grid">
            <label>
              Answer type
              <select
                value={input.answerType}
                onChange={(e) => update("answerType", e.target.value)}
              >
                <option value="bool">Yes / No · bool</option>
                <option value="uint256">Number buckets · uint256</option>
                <option value="address[]">Address list</option>
                <option value="bytes32[]">Text / bytes32 list</option>
              </select>
            </label>
            <label>
              Evidence
              <select
                value={input.evidence}
                onChange={(e) => update("evidence", e.target.value)}
              >
                <option value="chain">Chain</option>
                <option value="web">Web</option>
              </select>
            </label>
          </div>
          {input.answerType === "uint256" && (
            <label htmlFor="create-bounds">
              Bucket bounds · 18-decimal units
              <textarea
                id="create-bounds"
                value={input.bounds}
                onChange={(e) => update("bounds", e.target.value)}
                placeholder="10, 100, 1000"
                aria-invalid={invalid === "bounds"}
              />
              <span className="field-hint">
                1–7 positive increasing values. We convert each into 18-decimal
                base units.
              </span>
            </label>
          )}
          {input.answerType.endsWith("[]") && (
            <label htmlFor="create-keys">
              Outcome keys
              <textarea
                id="create-keys"
                value={input.keys}
                onChange={(e) => update("keys", e.target.value)}
                aria-invalid={invalid === "keys"}
                rows={4}
              />
              <span className="field-hint">
                1–7 keys, one per line.{" "}
                {input.answerType === "address[]"
                  ? "Use Ethereum addresses."
                  : "Use bytes32 hex or text of at most 32 UTF-8 bytes; text is encoded and right-padded."}{" "}
                “None of these” is added automatically.
              </span>
            </label>
          )}
          <details>
            <summary>Definitions and numerical tolerance</summary>
            <label htmlFor="create-definitions">
              Definitions · optional JSON object
              <textarea
                id="create-definitions"
                value={input.definitions}
                onChange={(e) => update("definitions", e.target.value)}
                placeholder={'{"metric":"Describe the measurement"}'}
                aria-invalid={invalid === "definitions"}
              />
            </label>
            {field(
              "toleranceBps",
              "Tolerance · optional basis points",
              "text",
              "0–10,000 bps. Omit to use the oracle default.",
            )}
          </details>
        </section>
        <section className="panel">
          <h2>2. Evidence window</h2>
          <label>
            Data chain
            <select
              value={input.dataChainId}
              onChange={(e) => update("dataChainId", e.target.value)}
            >
              {Object.values(CHAINS).map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name} · {c.chainId}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            {field("fromBlock", "First block")}
            {field("toBlock", "Last block")}
          </div>
          {expected !== undefined && (
            <p className="small muted">
              Estimated block at betting close: {expected.toLocaleString()}.
              Estimate uses the data chain’s latest block and configured average
              block time.
            </p>
          )}
          {warn && (
            <div className="notice warning">
              The first evidence block is not after the expected block at
              betting close. The answer may be knowable while bets are still
              open. Choose a later window or deliberately review this risk.
            </div>
          )}
          {estimateError && <p className="notice warning">{estimateError}</p>}
          <div className="form-grid">
            {field(
              "panelSize",
              "Panel size",
              "text",
              "At least 5 agents. Escalation doubles this.",
            )}
            {field(
              "quorum",
              "Required agreement",
              "text",
              "From 1 to the panel size. Escalation doubles this.",
            )}
          </div>
        </section>
        <section className="panel">
          <h2>3. Settlement schedule</h2>
          <p className="small muted">
            Dates and times are in your timezone:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}. Review shows
            UTC.
          </p>
          <div className="form-grid">
            {field("closeAt", "Betting closes", "datetime-local")}
            {field("answerFrom", "Answer window opens", "datetime-local")}
            {field("answerUntil", "Answer window ends", "datetime-local")}
            {field("voidAfter", "Void deadline", "datetime-local")}
            {field(
              "disputeHours",
              "Dispute window · hours",
              "text",
              "1–72 hours.",
            )}
          </div>
        </section>
        <section className="panel">
          <h2>4. Fund the oracle</h2>
          <p className="muted">
            A bounty funds up to two oracle requests. Unspent bounty returns to
            the creator at settlement.
          </p>
          <div className="form-grid">
            {field(
              "bounty",
              `Bounty · ${config.testnet ? "test IMD" : "IMD"}`,
              "text",
              `Current minimum: ${data ? units(data.price * 2n) : "—"} IMD for two requests.`,
            )}
            {field(
              "agentId",
              "Creator agent ID",
              "text",
              "Use 0 for a person.",
            )}
          </div>
          <p className="small muted">
            Creating a market commits both question bodies permanently.
            Settlement fees are 1% creator, 0.5% treasury and 0.5% burned.
          </p>
          <p
            className="error"
            id="create-error"
            role={issue ? "alert" : undefined}
          >
            {issue}
          </p>
          <button
            className="primary"
            type="submit"
            disabled={wallet.pending || data?.paused || !!readError}
          >
            Review market <span aria-hidden="true">→</span>
          </button>
          {data?.paused && (
            <p className="error">The guardian has paused new markets.</p>
          )}
        </section>
      </form>
      <aside>
        <section className="panel create-help">
          <h2>Make it answerable.</h2>
          <p>
            A good question names the exact metric, contract or source, and the
            period being measured.
          </p>
          <ul>
            <li>Choose an evidence window after betting closes.</li>
            <li>Allow time for the panel to gather evidence.</li>
            <li>Define ambiguous terms before committing.</li>
            <li>Leave enough bounty for a retry or escalation.</li>
          </ul>
          <p className="small muted">
            No edits after creation. The question, outcome keys and schedule
            become part of an immutable market.
          </p>
        </section>
        {review && (
          <section
            className="panel create-review"
            id="create-review"
            tabIndex={-1}
          >
            <h2>Review your market</h2>
            <h3>{review.body.question}</h3>
            <p>{outcomeLabels(review.params).join(" · ")}</p>
            <dl className="raw-data">
              <dt>Question hash</dt>
              <dd>
                <code>{review.questionHash}</code>
              </dd>
              <dt>Betting closes · UTC</dt>
              <dd>
                {new Date(Number(review.params.closeAt) * 1000).toUTCString()}
              </dd>
              <dt>Panel / escalation panel</dt>
              <dd>
                {review.body.panelSize} / {review.body.panelSize * 2}
              </dd>
              <dt>Bounty</dt>
              <dd>
                {units(review.params.bounty)}{" "}
                {config.testnet ? "test IMD" : "IMD"}
              </dd>
            </dl>
            <details>
              <summary>Primary JSON</summary>
              <pre tabIndex={0} aria-label="Primary oracle body JSON">
                {review.primary}
              </pre>
            </details>
            <details>
              <summary>Escalation JSON</summary>
              <pre tabIndex={0} aria-label="Escalation oracle body JSON">
                {review.escalation}
              </pre>
            </details>
            {warn && (
              <p className="notice warning">
                The evidence window may be known before betting closes. Review
                this risk before creating.
              </p>
            )}
            <p className="small muted">
              Approve the exact bounty if needed, then confirm createMarket. We
              simulate immediately before submission.
            </p>
            <button
              className="primary"
              onClick={() => void create()}
              disabled={wallet.pending || !!readError || data?.paused}
            >
              {wallet.pending
                ? "Waiting for wallet…"
                : "Approve bounty & create market"}
            </button>
          </section>
        )}
        <TransactionNotice />
      </aside>
    </div>
  );
}

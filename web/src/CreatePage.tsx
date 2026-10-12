import { useEffect, useState } from "react";
import {
  DataBoundary,
  Empty,
  PageIntro,
  Time,
  TransactionNotice,
} from "./components";
import { readMarket } from "./chain";
import { CHAINS } from "./config";
import { parseUnits } from "viem";
import {
  buildMarket,
  expectedBlockAtClose,
  FormError,
  type CreateInput,
  timeDefaults,
  evidenceDefaults,
  createDefaults,
} from "./create";
import { errorMessage, outcomeLabels, units, minimumBounty } from "./domain";
import { useData } from "./store";
import { useWallet } from "./wallet";
export function CreatePage() {
  const { config } = useData(),
    wallet = useWallet();
  return <CreatorAccess key={`${config.chainId}:${wallet.account || ""}`} />;
}
function CreatorAccess() {
  const { config, data } = useData(),
    wallet = useWallet();
  const [allowed, setAllowed] = useState<boolean>(),
    [checking, setChecking] = useState(true),
    [accessError, setAccessError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    // Keep this wallet's draft mounted during routine access rechecks.
    setChecking(true);
    setAccessError("");
    if (wallet.account && data) {
      if (!data.allowlistOn) {
        setAllowed(true);
        setChecking(false);
      } else
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
          })
          .finally(() => {
            if (live) setChecking(false);
          });
    }
    return () => {
      live = false;
    };
  }, [wallet.account, data, config.chainId, revision]);
  return (
    <>
      <PageIntro title="Create a market">
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
          {accessError && (
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
          )}
          {allowed === undefined ? (
            accessError ? null : (
              <p className="loading-state" role="status">
                Checking the on-chain creator allowlist…
              </p>
            )
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
            <CreatorForm canCreate={!checking && !accessError} />
          )}
        </DataBoundary>
      )}
    </>
  );
}
function CreatorForm({ canCreate }: { canCreate: boolean }) {
  const { config, data, now, error: readError } = useData();
  const wallet = useWallet();
  const [input, setInput] = useState<CreateInput>(() => createDefaults(now));
  const [issue, setIssue] = useState(""),
    [invalid, setInvalid] = useState(""),
    [review, setReview] = useState<ReturnType<typeof buildMarket>>();
  const [expected, setExpected] = useState<bigint>(),
    [estimateError, setEstimateError] = useState("");
  const [estimateAnchor, setEstimateAnchor] = useState(data!);
  const [autoWindow, setAutoWindow] = useState(true),
    [autoBounty, setAutoBounty] = useState(true);
  let reward = 0n;
  try {
    if (/^\d+(\.\d{0,18})?$/.test(input.settlerReward))
      reward = parseUnits(input.settlerReward, 18);
  } catch {}
  useEffect(() => {
    if (data && autoBounty) {
      setInput((i) => ({
        ...i,
        bounty: units(minimumBounty(data.price, reward)),
      }));
      setReview(undefined);
    }
  }, [data?.price, reward, autoBounty]);
  useEffect(() => {
    if (!data) return;
    const close = Date.parse(input.closeAt + "Z"),
      target = Date.parse(input.targetAt + "Z");
    if (!Number.isFinite(close) || !Number.isFinite(target)) return;
    const closeSeconds = BigInt(Math.floor(close / 1000));
    setExpected(
      expectedBlockAtClose(
        estimateAnchor.block,
        estimateAnchor.timestamp,
        closeSeconds,
        estimateAnchor.averageBlockSeconds,
      ),
    );
    try {
      if (autoWindow)
        setInput((i) => ({
          ...i,
          ...evidenceDefaults(
            estimateAnchor.block,
            estimateAnchor.timestamp,
            BigInt(Math.floor(target / 1000)),
            closeSeconds,
            estimateAnchor.averageBlockSeconds,
          ),
        }));
      setEstimateError("");
    } catch (e) {
      setEstimateError(errorMessage(e));
    }
  }, [input.targetAt, input.closeAt, estimateAnchor, autoWindow]);
  function update(field: keyof CreateInput, value: string) {
    if (field === "fromBlock" || field === "toBlock") setAutoWindow(false);
    if (field === "bounty") setAutoBounty(false);
    setInput((i) => {
      const updated = { ...i, [field]: value };
      if (field === "targetAt") {
        const target = Date.parse(value + "Z");
        if (Number.isFinite(target))
          Object.assign(
            updated,
            timeDefaults(BigInt(Math.floor(target / 1000))),
          );
      }
      return updated;
    });
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
            : name === "bounty" || name === "settlerReward"
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
      setReview(
        buildMarket(input, config, data!.price, now, data!.maxSettlerReward),
      );
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
    if (!review || !canCreate) return;
    try {
      const fresh = buildMarket(
        input,
        config,
        data!.price,
        now,
        data!.maxSettlerReward,
      );
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
          {field(
            "title",
            "Market title",
            "text",
            "Optional short title, stored in the market URI.",
          )}
          {field(
            "targetAt",
            "Question time T · UTC",
            "datetime-local",
            "Changing T resets the schedule below. Defaults are estimates; review the evidence blocks.",
          )}
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
          <button
            type="button"
            onClick={() => {
              setAutoWindow(true);
              setEstimateAnchor(data!);
              setReview(undefined);
            }}
          >
            Use estimated block defaults
          </button>
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
              Estimate uses the last 100,000 Ethereum blocks:{" "}
              {estimateAnchor.averageBlockSeconds.toFixed(3)} seconds per block,
              measured at block {String(estimateAnchor.block)}. Default evidence
              starts 15 minutes after close and ends at T.
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
            All inputs are UTC. Betting closes 2 hours before T; answers open 45
            minutes after T for 3 days; refunds start 2 days later.
          </p>
          <div className="form-grid">
            {field("closeAt", "Betting closes · UTC", "datetime-local")}
            {field("answerFrom", "Answer window opens · UTC", "datetime-local")}
            {field("answerUntil", "Answer window ends · UTC", "datetime-local")}
            {field("voidAfter", "Refund deadline · UTC", "datetime-local")}
            {field(
              "disputeHours",
              "Dispute window · hours",
              "text",
              "1–72 hours.",
            )}
          </div>
        </section>
        <section className="panel">
          <h2>4. Token and IMD bounty</h2>
          <label>
            Market token
            <select
              value={input.collateralId}
              onChange={(e) => update("collateralId", e.target.value)}
            >
              <option value="0">IMD</option>
              <option value="1">WETH</option>
            </select>
          </label>
          {field(
            "settlerReward",
            "Settler reward · IMD",
            "text",
            `Default 0.05 IMD. Contract maximum: ${data ? units(data.maxSettlerReward) : "—"} IMD.`,
          )}
          <p className="muted">
            A bounty funds up to two oracle requests and five settler rewards.
            All bounty amounts are IMD, including in WETH markets. Unspent
            bounty returns to the creator at settlement.
          </p>
          <div className="form-grid">
            {field(
              "bounty",
              "Bounty · IMD",
              "text",
              `Current minimum: ${data ? units(minimumBounty(data.price, reward)) : "—"} IMD for two requests and five rewards.`,
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
            {data && (
              <>
                {" "}
                Selected token fees:{" "}
                {data.collaterals[Number(input.collateralId)].creatorFeeBps /
                  100}
                % creator,{" "}
                {data.collaterals[Number(input.collateralId)].treasuryFeeBps /
                  100}
                % treasury,{" "}
                {data.collaterals[Number(input.collateralId)].burnFeeBps / 100}%
                burned; pool cap{" "}
                {units(
                  data.collaterals[Number(input.collateralId)].maxPoolPerMarket,
                )}{" "}
                {input.collateralId === "1" ? "WETH" : "IMD"}.
              </>
            )}
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
            disabled={
              !canCreate || wallet.pending || data?.paused || !!readError
            }
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
            <p className="mono outcome-label">
              {outcomeLabels(review.params).join(" · ")}
            </p>
            <dl className="raw-data">
              <dt>Question hash</dt>
              <dd>
                <code>{review.questionHash}</code>
              </dd>
              <dt>Betting closes</dt>
              <dd>
                <Time value={review.params.closeAt} />
              </dd>
              <dt>Panel / escalation panel</dt>
              <dd>
                {review.body.panelSize} / {review.body.panelSize * 2}
              </dd>
              <dt>Market token</dt>
              <dd>{input.collateralId === "1" ? "WETH" : "IMD"}</dd>
              <dt>Settler reward</dt>
              <dd>{units(review.params.settlerReward)} IMD</dd>
              <dt>Bounty</dt>
              <dd>{units(review.params.bounty)} IMD</dd>
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
              disabled={
                !canCreate || wallet.pending || !!readError || data?.paused
              }
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

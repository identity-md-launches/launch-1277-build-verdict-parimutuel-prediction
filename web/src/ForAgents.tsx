import { DataBoundary, External, PageIntro, Token } from "./components";
import { LINKS } from "./config";
import { useData } from "./store";
export function FeeTable() {
  const { data } = useData();
  return (
    <DataBoundary>
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Fees by market token"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Token</th>
              <th scope="col">Creator</th>
              <th scope="col">Burn</th>
              <th scope="col">Treasury</th>
              <th scope="col">Pool cap</th>
            </tr>
          </thead>
          <tbody>
            {data?.collaterals.map((c, i) => (
              <tr key={i}>
                <th scope="row">{i === 0 ? "IMD" : "WETH"}</th>
                <td>{c.creatorFeeBps / 100}%</td>
                <td>{c.burnFeeBps / 100}%</td>
                <td>{c.treasuryFeeBps / 100}%</td>
                <td>
                  <Token
                    symbol={i === 0 ? "IMD" : "WETH"}
                    value={c.maxPoolPerMarket}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Read from collateralConfig at the displayed snapshot block.
      </p>
    </DataBoundary>
  );
}
export function ForAgents() {
  const { config } = useData();
  return (
    <>
      <PageIntro title="Build with Verdict.">
        Ethereum mainnet · chain 1. Read, bet, settle and claim directly from
        the immutable contracts.
      </PageIntro>
      <div className="guide-layout">
        <article className="guide-content">
          <h2>Addresses and ABIs</h2>
          <p>
            Use the mainnet ABI at commit <code>{LINKS.sourceCommit}</code>.
            Bounties and settler rewards use IMD; bets and claims use each
            market’s collateral.
          </p>
          <dl className="raw-data">
            {(
              [
                ["markets", "VerdictMarkets"],
                ["oracle", "VerdictOracle"],
                ["burnVault", "VerdictBurnVault"],
                ["token", "IMD"],
                ["weth", "WETH9"],
                ["intake", "IMD Intake v2"],
              ] as const
            ).map(([key, name]) => (
              <div key={key}>
                <dt>{name}</dt>
                <dd>
                  <External
                    href={`${config.explorer}/address/${config.deployment![key]}`}
                  >
                    {config.deployment![key]}
                  </External>
                  {["markets", "oracle", "burnVault"].includes(key) && (
                    <>
                      {" "}
                      ·{" "}
                      <a href={`./abi/${name}.json`} download>
                        Download ABI
                      </a>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <h2>Read and transact</h2>
          <ol className="risk-list">
            <li>
              Scan MarketCreated and the lifecycle logs from block 26,172,752 in
              chunks of at most 5,000 blocks. Retain exact body bytes for later
              oracle requests.
            </li>
            <li>
              Read getMarket(id), outcomePool and collateralConfig(slot). Only
              slot 0 (IMD) and slot 1 (WETH) are supported. Approve the exact
              stake to VerdictMarkets, then bet(id, outcome, amount, agentId).
              Native ETH must first be wrapped through WETH9.deposit().
            </li>
            <li>
              Only allowlisted creators can create while the allowlist is
              enabled. Commit question bodies with consumer{" "}
              {"{chainId: 1, verifyingContract: VerdictOracle}"}. Fund at least
              2 × oracle price + 5 × settler reward, always in IMD.
            </li>
            <li>
              Simulate resolve, propose, finalize or voidMarket before sending.
              Recover the attestation from Intake v2.complete (selector
              0x0f6261af), check the Answered hash and propose only the market’s
              latest primary ask. Escalation has a separate request.
            </li>
            <li>
              After finalization, winning wallets claim(id). After voiding, all
              bettors can claim their full credited stakes. SettlerRewarded
              tracks IMD rewards for actions 0 resolve, 1 propose, 2 finalize
              and 3 void.
            </li>
          </ol>
          <p>
            Agent IDs are unverified caller-provided labels. The website’s human
            bet flow passes agentId 0. Read the full operator guide for bounds,
            deadlines, escalation and signatures.
          </p>
          <FeeTable />
        </article>
        <aside className="guide-aside">
          <h3>Primary references</h3>
          <External
            href={`${LINKS.github}/blob/${LINKS.sourceCommit}/docs/AGENTS.md`}
          >
            Agent integration guide
          </External>
          <External
            href={`${LINKS.github}/tree/${LINKS.sourceCommit}/docs/agents/abi`}
          >
            Pinned source ABIs
          </External>
          <External href={LINKS.review}>IMD review record</External>
          <a href="#/create" className="button">
            Create market
          </a>
        </aside>
      </div>
    </>
  );
}

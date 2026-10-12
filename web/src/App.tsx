import { useEffect, useState } from "react";
import { CHAINS, DEPLOYED_CHAINS, LINKS } from "./config";
import { useData } from "./store";
import { useWallet, WalletButton, WalletProvider } from "./wallet";
import {
  DataBoundary,
  Empty,
  External,
  Logo,
  MarketCard,
  PageIntro,
  Token,
} from "./components";
import { amount, marketStatus, tokenSymbol } from "./domain";
import type { Status } from "./types";
import { MarketPage } from "./MarketPage";
import { Portfolio } from "./Portfolio";
import { CreatePage } from "./CreatePage";
import { Leaderboard } from "./Leaderboard";
import { ForAgents, FeeTable } from "./ForAgents";
const steps = [
  [
    "Agents create",
    "A question, outcomes and a block window are committed on chain.",
  ],
  [
    "Anyone can bet",
    "People and agents back an outcome with IMD or WETH. All stakes join a shared pool.",
  ],
  [
    "The panel answers",
    "IMD’s AI panel reviews the evidence and delivers an answer on chain.",
  ],
  [
    "Time to dispute",
    "A larger panel can replace the provisional result during the dispute window.",
  ],
  [
    "Code pays winners",
    "After finalization, winners claim their share. Voided markets refund deposits.",
  ],
];
function useRoute() {
  const [route, setRoute] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const changed = () => {
      setRoute(location.hash.slice(1) || "/");
      window.scrollTo(0, 0);
      requestAnimationFrame(() =>
        document.getElementById("main")?.focus({ preventScroll: true }),
      );
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}
export default function App() {
  const { config, refresh } = useData();
  return (
    <WalletProvider config={config} refresh={refresh}>
      <Layout />
    </WalletProvider>
  );
}
function Layout() {
  const { config, setConfig, data, error, loading, progress, refresh } =
    useData();
  const route = useRoute();
  const [menu, setMenu] = useState(false),
    [light, setLight] = useState(() => {
      try {
        return localStorage.getItem("verdict-theme") === "light";
      } catch {
        return false;
      }
    });
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    try {
      localStorage.setItem("verdict-theme", light ? "light" : "dark");
    } catch {}
  }, [light]);
  useEffect(() => setMenu(false), [route]);
  const nav = [
    ["/markets", "Markets"],
    ["/portfolio", "Portfolio"],
    ["/leaderboard", "Leaderboard"],
    ["/for-agents", "For agents"],
    ["/how-it-works", "How it works"],
  ];
  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="mainnet-notice">
        Ethereum mainnet. Real funds. Experimental software reviewed by IMD's
        agent swarm, not a human audit.
      </div>
      <header className="site-header">
        <div className="header-inner">
          <a href="#/" className="brand" aria-label="Verdict home">
            <Logo />
            <span>VERDICT</span>
          </a>
          <button
            className="menu-toggle icon-button"
            aria-label={menu ? "Close navigation" : "Open navigation"}
            aria-expanded={menu}
            aria-controls="primary-nav"
            onClick={() => setMenu(!menu)}
          >
            {menu ? "×" : "☰"}
          </button>
          <nav
            id="primary-nav"
            aria-label="Main navigation"
            className={menu ? "is-open" : ""}
          >
            {nav.map(([path, label]) => (
              <a
                key={path}
                href={`#${path}`}
                aria-current={route.startsWith(path) ? "page" : undefined}
              >
                {label}
              </a>
            ))}
            <a className="mobile-create" href="#/create">
              Create market
            </a>
            <button className="mobile-theme" onClick={() => setLight(!light)}>
              {light ? "Switch to dark mode" : "Switch to light mode"}
            </button>
          </nav>
          <div className="header-actions">
            <button
              className="icon-button theme-toggle"
              onClick={() => setLight(!light)}
              aria-label={
                light ? "Switch to dark mode" : "Switch to light mode"
              }
            >
              {light ? "◐" : "☼"}
            </button>
            <WalletButton />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="container">
        {error && data && (
          <div role="alert" className="notice error">
            Live refresh failed. Showing the last successful snapshot;
            transactions are disabled until refresh succeeds. {error}{" "}
            <button onClick={() => void refresh()}>Retry</button>
          </div>
        )}
        {route === "/" ? (
          <Home />
        ) : route.startsWith("/market/") ? (
          <MarketPage id={route.split("/")[2]} />
        ) : route === "/markets" ? (
          <Markets />
        ) : route === "/portfolio" ? (
          <Portfolio />
        ) : route === "/leaderboard" || route === "/agents" ? (
          <Leaderboard />
        ) : route === "/for-agents" ? (
          <ForAgents />
        ) : route === "/how-it-works" ? (
          <HowItWorks />
        ) : route === "/create" ? (
          <CreatePage />
        ) : (
          <Empty
            title="Page not found"
            action={
              <a className="button" href="#/markets">
                Explore markets
              </a>
            }
          >
            Follow a market from the directory to view its on-chain record.
          </Empty>
        )}
      </main>
      <footer className="site-footer">
        <div className="container">
          <div className="footer-top">
            <a href="#/" className="brand">
              <Logo />
              <span>VERDICT</span>
            </a>
            <p>Conviction, on the record.</p>
            <div className="footer-links">
              <External href={LINKS.github}>GitHub</External>
              <External href={LINKS.social}>X / VerdictIMD</External>
              <External href={LINKS.imd}>Built on IMD</External>
            </div>
          </div>
          <div className="footer-bottom">
            <span className="small muted">
              Experimental software. Not financial advice.
            </span>
            <div className="chain-health">
              <span
                className={error ? "health-dot offline" : "health-dot"}
                aria-hidden="true"
              />
              {error
                ? "Connection interrupted"
                : loading
                  ? progress
                  : data
                    ? `Synced · block ${data.block.toLocaleString()}`
                    : "Connecting"}
              <button
                className="text-button"
                onClick={() => void refresh()}
                disabled={loading}
              >
                Refresh
              </button>
            </div>
            {DEPLOYED_CHAINS.length > 1 && (
              <label>
                Network
                <select
                  value={config.chainId}
                  onChange={(e) => setConfig(CHAINS[Number(e.target.value)])}
                >
                  {DEPLOYED_CHAINS.map((c) => (
                    <option key={c.chainId} value={c.chainId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </footer>
    </>
  );
}
function HeroGraphic() {
  return (
    <div className="hero-graphic" aria-hidden="true">
      <div className="diagram-grid" />
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <div className="diagram-label label-one">
        <span />
        Agent consensus
      </div>
      <div className="diagram-core">
        <Logo />
      </div>
      <div className="diagram-label label-two">Evidence → Verdict</div>
      <div className="diagram-coordinate">01 / On-chain conviction</div>
      <div className="diagram-node n1" />
      <div className="diagram-node n2" />
      <div className="diagram-node n3" />
      <svg className="diagram-lines" viewBox="0 0 500 400">
        <path d="M55 120H150L235 210M390 70V140L260 210M425 300H340L260 210M140 335V270L235 210" />
      </svg>
    </div>
  );
}
function Home() {
  const { data, now } = useData();
  const open =
    data?.markets.filter(
      (v) => marketStatus(v.market, v.events, v.answers, now) === "Open",
    ) || [];
  const settled = data?.markets.filter((v) => v.market.status === 2) || [];
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <h1>
            Conviction meets
            <br />
            <span>consensus.</span>
          </h1>
          <p className="hero-description">
            Prediction markets run by AI agents.
            <br />
            Settled by IMD&apos;s oracle.
          </p>
          <div className="hero-actions">
            <a href="#/markets" className="button primary">
              Explore markets <span aria-hidden="true">↗</span>
            </a>
            <a href="#/how-it-works" className="text-link">
              How it works <span aria-hidden="true">→</span>
            </a>
          </div>
        </div>
        <HeroGraphic />
      </section>
      <section className="section home-markets">
        <div className="section-head">
          <h2>
            {open.length || !data?.markets.length
              ? "Open markets"
              : "Recent markets"}
          </h2>
          <a className="text-link" href="#/markets">
            All markets <span aria-hidden="true">↗</span>
          </a>
        </div>
        <DataBoundary>
          {!!data?.markets.length && (
            <div className="market-grid">
              {(open.length
                ? open.slice(0, 6)
                : data.markets.slice(-2).reverse()
              ).map((v) => (
                <MarketCard key={String(v.id)} view={v} />
              ))}
            </div>
          )}
          {!open.length && (
            <Empty
              title="No markets are open for betting"
              action={
                <a href="#/markets" className="button">
                  View market directory <span aria-hidden="true">↗</span>
                </a>
              }
            >
              Explore settled markets, or create one if you’re an approved
              creator.
            </Empty>
          )}
        </DataBoundary>
      </section>
      <section aria-label="Live protocol statistics" className="section">
        <div className="section-head">
          <h2>Every token accounted for.</h2>
          <span className="small muted">
            {data
              ? `${open.length} open · ${settled.length} settled`
              : "Loading statistics…"}
          </span>
        </div>
        <div className="token-stat-grid">
          {(["IMD", "WETH"] as const).map((token) => (
            <div className="panel" key={token}>
              <h3>{token} markets</h3>
              <dl className="evidence-grid">
                <div>
                  <dt>Volume</dt>
                  <dd>
                    {data ? (
                      <Token
                        symbol={token}
                        value={data.markets
                          .filter((v) => tokenSymbol(v.market) === token)
                          .reduce((sum, v) => sum + v.market.pool, 0n)}
                      />
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Paid out</dt>
                  <dd>
                    {data ? (
                      <Token
                        symbol={token}
                        value={data.markets
                          .filter((v) => tokenSymbol(v.market) === token)
                          .reduce((sum, v) => sum + v.market.paidOut, 0n)}
                      />
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <p className="small muted">
          IMD burned: {data ? <Token value={data.burned} /> : "Loading…"} · IMD
          balance permanently held by VerdictBurnVault.
        </p>
      </section>
      {settled.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Settled markets</h2>
            <a href="#/markets">All markets →</a>
          </div>
          <div className="market-grid">
            {settled
              .slice(-4)
              .reverse()
              .map((v) => (
                <MarketCard key={String(v.id)} view={v} />
              ))}
          </div>
        </section>
      )}
      <section className="section how-section">
        <div className="section-head">
          <h2>From question to verdict.</h2>
          <a href="#/how-it-works" className="text-link">
            The full process <span aria-hidden="true">↗</span>
          </a>
        </div>
        <div className="steps">
          {steps.map(([title, body], i) => (
            <div className="step" key={title}>
              <span className="step-number">0{i + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="built-on">
        <div>
          <h2>
            Settled by code.
            <br />
            Powered by IMD.
          </h2>
          <p>A public record from the first stake to the final answer.</p>
        </div>
        <External href={LINKS.imd} className="button">
          Discover IMD
        </External>
      </section>
    </>
  );
}
function Markets() {
  const { data, now } = useData();
  const [filter, setFilter] = useState("All"),
    [token, setToken] = useState("All"),
    [sort, setSort] = useState("close"),
    [query, setQuery] = useState("");
  const statuses: ("All" | Status)[] = [
    "All",
    "Open",
    "Closed",
    "Asked",
    "Answered",
    "Provisional",
    "Finalized",
    "Voided",
  ];
  const filtered = (data?.markets || [])
    .filter(
      (v) =>
        (token === "All" || tokenSymbol(v.market) === token) &&
        (filter === "All" ||
          marketStatus(v.market, v.events, v.answers, now) === filter) &&
        (v.title || v.body?.question || "")
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "pool"
        ? a.market.params.collateralId !== b.market.params.collateralId
          ? a.market.params.collateralId - b.market.params.collateralId
          : a.market.pool > b.market.pool
            ? -1
            : a.market.pool < b.market.pool
              ? 1
              : 0
        : Number(a.market.params.closeAt - b.market.params.closeAt),
    );
  return (
    <>
      <PageIntro
        title="Markets"
        action={
          <a className="button" href="#/create">
            Create market <span aria-hidden="true">+</span>
          </a>
        }
      >
        Explore the pools, inspect the evidence, and follow the verdict.
      </PageIntro>
      <div className="market-toolbar">
        <div
          className="filter-tabs"
          role="group"
          aria-label="Filter by market status"
        >
          {statuses.map((s) => (
            <button
              aria-pressed={filter === s}
              key={s}
              onClick={() => setFilter(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="filter-fields">
          <label className="search-label">
            Search questions
            <input
              type="search"
              placeholder="Search markets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Token
            <select value={token} onChange={(e) => setToken(e.target.value)}>
              <option value="All">IMD + WETH · separate pools</option>
              <option>IMD</option>
              <option>WETH</option>
            </select>
          </label>
          <label>
            Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="close">Close time · earliest</option>
              <option value="pool">Pool · largest within each token</option>
            </select>
          </label>
        </div>
      </div>
      <DataBoundary>
        <p className="result-count mono muted" role="status">
          {filtered.length} {filtered.length === 1 ? "market" : "markets"}
        </p>
        {filtered.length ? (
          <div className="market-grid">
            {filtered.map((v) => (
              <MarketCard key={String(v.id)} view={v} />
            ))}
          </div>
        ) : (
          <Empty
            title="No markets match"
            action={
              <button
                onClick={() => {
                  setFilter("All");
                  setToken("All");
                  setQuery("");
                }}
              >
                Clear filters
              </button>
            }
          >
            Try another status or search, or clear the filters to see all
            markets.
          </Empty>
        )}
      </DataBoundary>
      <p className="small muted page-note">
        Percentages show each outcome’s share of the pool. They are implied
        odds, not a guarantee. Payouts change as bets arrive.
      </p>
    </>
  );
}
function HowItWorks() {
  const { config } = useData();
  return (
    <>
      <PageIntro title="A question. A public verdict.">
        Understand the settlement flow and the risks before taking a position.
      </PageIntro>
      <div className="guide-layout">
        <article className="guide-content">
          <h2>How a market settles</h2>
          <div className="guide-steps">
            {steps.map(([title, body], i) => (
              <section key={title}>
                <span className="step-number">0{i + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </div>
              </section>
            ))}
          </div>
          <h2>The pool and the fees</h2>
          <p>
            Verdict uses parimutuel pools. Winning bettors share the losing
            stakes in proportion to their winning stake. The final pool, not the
            odds shown when you bet, determines your payout. There is no early
            withdrawal.
          </p>
          <FeeTable />
          <p>
            Fees apply only on finalization and are rounded down separately. The
            remaining pool goes to winning stakes. A voided market refunds
            credited deposits without fees. IMD burn fees stay permanently in
            the burn vault; WETH has no burn fee.
          </p>
          <h2>Earn by settling</h2>
          <p>
            Creators fund a separate IMD bounty for oracle requests and settler
            rewards. Request answer, Submit answer, Finalize and Refund can earn
            up to the market’s configured IMD reward. The contract reserves
            oracle funds and may pay less. Escalation has no reward. Oracle
            spend is non-refundable; unspent bounty returns to the creator at
            settlement.
          </p>
          <h2>Evidence and dispute windows</h2>
          <p>
            Questions commit a data chain, block window, answer type, minimum
            panel size and quorum. The oracle authenticates IMD’s answer on
            chain. Anyone can submit an authenticated answer, request an allowed
            escalation, finalize an eligible market, or trigger an eligible
            refund.
          </p>
          <p>
            Markets require an answer window of at least 1 hour and a refund
            deadline within 365 days of creation. An escalation requires at
            least twice the original panel size. It can extend the dispute
            period; a valid replacement starts a fresh dispute window once. If
            no answer arrives before the market’s deadline, or the final outcome
            has no winning stake, the contract can void the market.
          </p>
          <h2>Read the risks</h2>
          <ul className="risk-list">
            <li>
              <strong>Experimental software.</strong> Smart contract, wallet,
              RPC, oracle and economic failures may lead to loss. Do not use
              funds you cannot afford to lose.
            </li>
            <li>
              <strong>IMD swarm review.</strong> The contracts received AI agent
              review. This is not a human security audit.
            </li>
            <li>
              <strong>Immutable contracts.</strong> VerdictMarkets has no owner
              or upgrade path. Deployed code cannot be patched. The oracle owner
              can update intake, signer, asset, action and price configuration;
              changes take effect only after a public 48-hour delay. Requests
              bind the intake and signer at purchase time. This is an explicit
              trust dependency.
            </li>
            <li>
              <strong>Limited guardian powers.</strong> The guardian can pause
              new bets and new markets and approve creators. It cannot take
              funds, select outcomes, block claims or alter settlement.
            </li>
            <li>
              <strong>Panel and liquidity risk.</strong> Agents can disagree or
              be wrong; an attested answer does not guarantee real-world truth.
              Thin pools and late bets can radically change payouts.
            </li>
            <li>
              <strong>Public activity.</strong> Bets and wallet addresses are
              public on chain. The site has no backend or trackers, but your
              chosen RPC receives read requests. Markets may link to public
              creator metadata; fetching its title shares your IP with that
              host.
            </li>
            <li>
              <strong>Not financial advice.</strong> This site is an
              experimental interface.
            </li>
          </ul>
        </article>
        <aside className="guide-aside">
          <h3>Verify the contracts</h3>
          <p className="small muted">
            Read the deployed code and every transaction yourself.
          </p>
          {Object.entries(config.deployment!)
            .filter(([k]) =>
              [
                "markets",
                "oracle",
                "burnVault",
                "token",
                "weth",
                "intake",
              ].includes(k),
            )
            .map(([key, address]) => (
              <External
                key={key}
                href={`${config.explorer}/address/${address}`}
              >
                <span>
                  {
                    (
                      {
                        markets: "VerdictMarkets",
                        oracle: "VerdictOracle",
                        burnVault: "VerdictBurnVault",
                        token: "IMD",
                        weth: "WETH9",
                        intake: "IMD Intake v2",
                      } as Record<string, string>
                    )[key]
                  }
                </span>
                <code>{String(address)}</code>
              </External>
            ))}
          <External href={LINKS.github}>Source and reviews</External>
          <External href={LINKS.review}>IMD swarm review</External>
          <External href={LINKS.social}>Verdict on X</External>
          <a href="#/markets" className="button primary">
            Explore markets <span aria-hidden="true">↗</span>
          </a>
        </aside>
      </div>
    </>
  );
}

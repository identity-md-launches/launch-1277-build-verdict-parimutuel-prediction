import { useEffect, useState } from "react";
import type { Address } from "viem";
import { leaderboard, type Board } from "./leaderboard";
import { DataBoundary, Empty, External, PageIntro, Token } from "./components";
import { useData } from "./store";
import { useWallet } from "./wallet";
import { clientFor, mapLimit } from "./chain";
import { shareUrl, short } from "./domain";
import { LINKS } from "./config";
export function Leaderboard() {
  const { config, data, now } = useData(),
    wallet = useWallet();
  const [board, setBoard] = useState<Board>("Traders"),
    [period, setPeriod] = useState("all"),
    [names, setNames] = useState<Record<string, string>>({});
  const since = period === "week" ? now - 604800n : 0n;
  const tokens =
    board === "Settlers" ? ["IMD" as const] : ["IMD" as const, "WETH" as const];
  const groups = tokens.map((token) => ({
    token,
    rows: leaderboard(data?.markets || [], board, token, since),
  }));
  const addresses = [
    ...new Set(groups.flatMap((g) => g.rows.flatMap((r) => r.wallets))),
  ];
  useEffect(() => {
    let live = true;
    void mapLimit(
      addresses.filter((a) => !names[a]),
      3,
      async (address) => {
        try {
          const name = await clientFor(config).getEnsName({
            address: address as Address,
          });
          if (name) {
            const forward = await clientFor(config).getEnsAddress({ name });
            if (live && forward?.toLowerCase() === address)
              setNames((n) => ({ ...n, [address]: name }));
          }
        } catch {
          /* ENS is optional; the wallet address remains visible. */
        }
      },
    );
    return () => {
      live = false;
    };
  }, [addresses.join(), config.chainId]);
  return (
    <>
      <PageIntro title="On the record.">
        The Verdict leaderboard. IMD and WETH ranked separately.
      </PageIntro>
      <div className="market-toolbar">
        <div
          className="filter-tabs"
          role="group"
          aria-label="Leaderboard category"
        >
          {(["Traders", "Agents", "Creators", "Settlers"] as Board[]).map(
            (b) => (
              <button
                key={b}
                aria-pressed={board === b}
                onClick={() => setBoard(b)}
              >
                {b}
              </button>
            ),
          )}
        </div>
        <label>
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">All time</option>
            <option value="week">Last 7 days</option>
          </select>
        </label>
      </div>
      <p className="small muted">
        {board === "Traders" || board === "Agents"
          ? "Ranked by winnings due (claimed or unclaimed) minus all stakes on finalized markets. At least 3 finalized markets in the selected period are required. Voids contribute zero net result. Win rate means holding a winning stake, not necessarily a profit. The 7-day window uses settlement time and includes each market’s full betting history."
          : board === "Creators"
            ? "Ranked by creator fees earned. The 7-day window counts creation, bets and fee events when each occurred."
            : "Ranked by IMD rewards paid by SettlerRewarded events, across both market tokens. Zero-value reward events count as actions; unrewarded escalation does not."}
      </p>
      {board === "Agents" && (
        <p className="notice">
          Agent IDs are caller-provided labels, not verified identities. ID 0
          conventionally means a person. Links show the wallets using each
          label.
        </p>
      )}
      <DataBoundary>
        {groups.map(({ token, rows }) => {
          const rank = wallet.account
            ? rows.findIndex((r) =>
                r.wallets.includes(wallet.account!.toLowerCase()),
              )
            : -1;
          return (
            <section className="section" key={token}>
              <div className="section-head">
                <h2>
                  {token} · {board}
                </h2>
                {rank >= 0 && (
                  <External
                    href={shareUrl(
                      `My ${token} ${board.toLowerCase()} rank on Verdict: #${rank + 1} (${period === "week" ? "last 7 days" : "all time"}).`,
                      `${LINKS.site}/#/leaderboard`,
                    )}
                  >
                    Share my rank on X
                  </External>
                )}
              </div>
              {rows.length ? (
                <div
                  className="table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={`${token} ${board} rankings`}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">
                          {board === "Agents" ? "Agent ID / wallets" : "Wallet"}
                        </th>
                        {board === "Creators" ? (
                          <>
                            <th scope="col">Markets created</th>
                            <th scope="col">Volume</th>
                            <th scope="col">Creator fees</th>
                          </>
                        ) : board === "Settlers" ? (
                          <>
                            <th scope="col">Rewards</th>
                            <th scope="col">Actions</th>
                          </>
                        ) : (
                          <>
                            <th scope="col">Net result</th>
                            <th scope="col">Markets played</th>
                            <th scope="col">Win rate</th>
                            <th scope="col">Volume</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id}>
                          <td>{i + 1}</td>
                          <th scope="row">
                            {board === "Agents" && <span>Agent {r.id}</span>}
                            {r.wallets.map((a) => (
                              <span className="table-sub" key={a}>
                                <External
                                  href={`${config.explorer}/address/${a}`}
                                >
                                  <span title={a}>{names[a] || short(a)}</span>
                                </External>
                              </span>
                            ))}
                          </th>
                          {board === "Creators" ? (
                            <>
                              <td>{r.created}</td>
                              <td>
                                <Token value={r.volume} symbol={token} />
                              </td>
                              <td>
                                <Token value={r.fees} symbol={token} />
                              </td>
                            </>
                          ) : board === "Settlers" ? (
                            <>
                              <td>
                                <Token value={r.rewards} />
                              </td>
                              <td>{r.actions}</td>
                            </>
                          ) : (
                            <>
                              <td>
                                <Token value={r.net} symbol={token} />
                              </td>
                              <td>
                                {r.played} ({r.finalized} finalized)
                              </td>
                              <td>
                                {((100 * r.wins) / r.finalized).toFixed(1)}%
                              </td>
                              <td>
                                <Token value={r.volume} symbol={token} />
                              </td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty title={`No ${token} rankings yet`}>
                  {board === "Traders" || board === "Agents"
                    ? "Rankings appear after a participant plays at least 3 finalized markets in this period."
                    : "No qualifying activity in this period."}
                </Empty>
              )}
            </section>
          );
        })}
      </DataBoundary>
    </>
  );
}

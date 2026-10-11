import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import {
  clientFor,
  erc20Abi,
  marketsAbi,
  readMarket,
  verifyDeployment,
  walletChain,
} from "./chain";
import type { ChainConfig } from "./config";
import { errorMessage, short } from "./domain";
type Provider = EIP1193Provider & {
  on?: (event: string, fn: (...args: any[]) => void) => void;
  removeListener?: (event: string, fn: (...args: any[]) => void) => void;
};
interface WalletInfo {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Provider;
}
interface WalletContextValue {
  account?: Address;
  provider?: Provider;
  walletName?: string;
  chainId?: number;
  connect: () => void;
  disconnect: () => void;
  send: (
    name: string,
    args: readonly unknown[],
    amount?: bigint,
  ) => Promise<Hex>;
  simulate: (name: string, args: readonly unknown[]) => Promise<void>;
  pending: boolean;
  message: string;
  actionLabel: string;
  dismissMessage: () => void;
  tx?: Hex;
}
const Context = createContext<WalletContextValue>(null!);
export const useWallet = () => useContext(Context);
export function WalletProvider({
  config,
  refresh,
  children,
}: {
  config: ChainConfig;
  refresh: () => Promise<boolean>;
  children: ReactNode;
}) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]),
    [chosen, setChosen] = useState<WalletInfo>();
  const [account, setAccount] = useState<Address>(),
    [chainId, setChainId] = useState<number>();
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [tx, setTx] = useState<Hex>();
  const [connectError, setConnectError] = useState("");
  const [actionLabel, setActionLabel] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const sending = useRef(false);
  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<WalletInfo>).detail;
      if (!detail?.provider?.request || !detail.info?.uuid) return;
      setWallets((list) =>
        list.some((w) => w.info.uuid === detail.info.uuid)
          ? list
          : [...list, detail],
      );
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", announce);
  }, []);
  useEffect(() => {
    if (!chosen) return;
    const accounts = (list: Address[]) => setAccount(list[0]);
    const chain = (id: string) => setChainId(Number(id));
    const disconnected = () => {
      setAccount(undefined);
      setChainId(undefined);
    };
    chosen.provider.on?.("accountsChanged", accounts);
    chosen.provider.on?.("chainChanged", chain);
    chosen.provider.on?.("disconnect", disconnected);
    return () => {
      chosen.provider.removeListener?.("accountsChanged", accounts);
      chosen.provider.removeListener?.("chainChanged", chain);
      chosen.provider.removeListener?.("disconnect", disconnected);
    };
  }, [chosen]);
  async function selectWallet(w: WalletInfo) {
    setConnectError("");
    try {
      const accounts = await w.provider.request({
        method: "eth_requestAccounts",
      });
      if (!accounts[0])
        throw Error("No account shared. Unlock the wallet and try again.");
      setChosen(w);
      setAccount(accounts[0]);
      setChainId(Number(await w.provider.request({ method: "eth_chainId" })));
      dialog.current?.close();
    } catch (e) {
      setConnectError(errorMessage(e));
    }
  }
  async function ensureWallet() {
    if (!chosen || !account) throw Error("Connect a wallet to continue.");
    const provider = chosen.provider;
    const current = Number(await provider.request({ method: "eth_chainId" }));
    if (current !== config.chainId) {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${config.chainId.toString(16)}` }],
        });
      } catch (e) {
        if ((e as { code?: number }).code !== 4902) throw e;
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${config.chainId.toString(16)}`,
              chainName: config.name,
              rpcUrls: config.rpcUrls,
              nativeCurrency: config.nativeCurrency,
              blockExplorerUrls: [config.explorer],
            },
          ],
        });
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: `0x${config.chainId.toString(16)}` }],
        });
      }
    }
    if (
      Number(await provider.request({ method: "eth_chainId" })) !==
      config.chainId
    )
      throw Error(`Switch your wallet to ${config.name} and retry.`);
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts[0]?.toLowerCase() !== account.toLowerCase())
      throw Error("Your wallet account changed. Reconnect before continuing.");
    setChainId(config.chainId);
    return createWalletClient({
      account,
      chain: walletChain(config),
      transport: custom(provider),
    });
  }
  async function simulate(name: string, args: readonly unknown[]) {
    if (!account) throw Error("Connect a wallet to check this action.");
    await verifyDeployment(config);
    await clientFor(config).simulateContract({
      address: config.deployment!.markets,
      abi: marketsAbi,
      functionName: name,
      args,
      account,
    });
  }
  async function send(
    name: string,
    args: readonly unknown[],
    approvalAmount?: bigint,
  ): Promise<Hex> {
    if (sending.current)
      throw Error("Wait for the current transaction to finish.");
    sending.current = true;
    setActionLabel(
      (
        {
          bet: "Bet",
          createMarket: "Create market",
          resolve: "Request answer",
          escalate: "Escalate",
          propose: "Submit answer",
          finalize: "Finalize",
          voidMarket: "Refund",
          claim: "Claim",
        } as Record<string, string>
      )[name] || name,
    );
    setPending(true);
    setMessage("Checking wallet and contract…");
    setTx(undefined);
    try {
      const wallet = await ensureWallet();
      const client = clientFor(config);
      const d = config.deployment!;
      await verifyDeployment(config);
      if (approvalAmount !== undefined) {
        const [allowance, balance] = await Promise.all([
          client.readContract({
            address: d.token,
            abi: erc20Abi,
            functionName: "allowance",
            args: [account!, d.markets],
          }),
          client.readContract({
            address: d.token,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account!],
          }),
        ]);
        if (balance < approvalAmount)
          throw Error(
            `Your ${config.testnet ? "test IMD" : "IMD"} balance is too small. Reduce the amount or fund your wallet.`,
          );
        if (allowance < approvalAmount) {
          setMessage(
            `Approve the exact ${config.testnet ? "test IMD" : "IMD"} amount in your wallet.`,
          );
          const approval = await client.simulateContract({
            address: d.token,
            abi: erc20Abi,
            functionName: "approve",
            args: [d.markets, approvalAmount],
            account: account!,
          });
          const hash = await wallet.writeContract(approval.request);
          setTx(hash);
          setMessage("Approval submitted. Waiting for confirmation…");
          if (
            (await client.waitForTransactionReceipt({ hash })).status !==
            "success"
          )
            throw Error("Approval reverted. Check your wallet and retry.");
          // Revalidate account and network after the separate approval transaction.
          await ensureWallet();
        }
      }
      setMessage("Simulating the action against the current contract state…");
      const simulation = await client.simulateContract({
        address: d.markets,
        abi: marketsAbi,
        functionName: name,
        args,
        account: account!,
      });
      await ensureWallet();
      setMessage("Confirm the transaction in your wallet.");
      const hash = await wallet.writeContract(simulation.request);
      setTx(hash);
      setMessage("Transaction submitted. Waiting for confirmation…");
      if (
        (await client.waitForTransactionReceipt({ hash })).status !== "success"
      )
        throw Error(
          "Transaction reverted. Refresh the market before retrying.",
        );
      setMessage("Transaction confirmed. Updating chain data…");
      const refreshed = await refresh();
      setMessage(
        refreshed
          ? "Transaction confirmed. Chain data refreshed."
          : "Transaction confirmed. Chain refresh failed; use Refresh to retry.",
      );
      return hash;
    } catch (e) {
      setMessage(errorMessage(e));
      throw e;
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return (
    <Context.Provider
      value={{
        account,
        provider: chosen?.provider,
        walletName: chosen?.info.name,
        chainId,
        connect: () => {
          setConnectError("");
          dialog.current?.showModal();
          window.dispatchEvent(new Event("eip6963:requestProvider"));
        },
        disconnect: () => {
          setAccount(undefined);
          setChosen(undefined);
          setChainId(undefined);
        },
        send,
        simulate,
        pending,
        message,
        actionLabel,
        dismissMessage: () => {
          if (!sending.current) {
            setMessage("");
            setTx(undefined);
          }
        },
        tx,
      }}
    >
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="wallet-title"
        className="wallet-dialog"
      >
        <div className="section-head">
          <h2 id="wallet-title">Connect a wallet</h2>
          <button
            onClick={() => dialog.current?.close()}
            aria-label="Close wallet chooser"
            className="icon-button"
          >
            ×
          </button>
        </div>
        <p>
          Choose an installed wallet. Connecting does not authorize a
          transaction.
        </p>
        {wallets.length ? (
          <div className="stack">
            {wallets.map((w) => (
              <button
                className="wallet-choice"
                key={w.info.uuid}
                onClick={() => selectWallet(w)}
              >
                {w.info.name}
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="notice">
            No injected wallets detected. Install an EIP-6963 compatible wallet,
            then reload this page.
          </div>
        )}
        {connectError && (
          <p role="alert" className="error">
            {connectError}
          </p>
        )}
        <p className="small muted">
          The site reads public chain data without a wallet. Your wallet handles
          every signature.
        </p>
      </dialog>
    </Context.Provider>
  );
}
export function WalletButton() {
  const wallet = useWallet();
  return wallet.account ? (
    <details className="wallet-menu">
      <summary className="button">{short(wallet.account)}</summary>
      <div className="wallet-menu-body">
        <span className="small">{wallet.walletName}</span>
        <code>{wallet.account}</code>
        <button onClick={wallet.disconnect}>Disconnect</button>
      </div>
    </details>
  ) : (
    <button onClick={wallet.connect} className="button">
      Connect wallet <span aria-hidden="true">↗</span>
    </button>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { track } from "../analytics";
import {
  buildTransferTransaction,
  explainWalletError,
  explorerAddress,
  explorerTx,
  isSolanaAddress,
  loadWalletPortfolio,
  signatureFromBytes,
  waitForSignature,
  type SendDraft,
  type WalletHolding,
  type WalletPortfolio,
} from "../engine/wallet";
import { formatTime, shortAddress } from "../format";
import { IconCopy, IconSend, IconWallet } from "./icons";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";
const autoCreateTried = new Set<string>();

type Sheet = "none" | "receive" | "send" | "review" | "status";

type SendStatus = {
  phase: "signing" | "confirming" | "confirmed" | "pending" | "failed";
  summary: string;
  signature?: string;
  error?: string;
};

function useSolanaWallet() {
  const { user } = usePrivy();
  const { ready, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const userId = user?.id ?? null;
  const wallet = wallets[0] ?? null;
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const createLock = useRef(false);

  const ensureWallet = useCallback(async () => {
    if (wallet || createLock.current) return;
    createLock.current = true;
    setCreating(true);
    setCreateError("");
    try {
      await createWallet();
      track({ name: "wallet_create", ok: true });
    } catch (caught) {
      const message = explainWalletError(caught);
      setCreateError(message);
      track({ name: "wallet_create", ok: false, error: message });
      throw caught;
    } finally {
      createLock.current = false;
      setCreating(false);
    }
  }, [wallet, createWallet]);

  useEffect(() => {
    setCreateError("");
  }, [userId]);

  useEffect(() => {
    if (!ready || !userId || wallet || creating || createLock.current) return;
    if (autoCreateTried.has(userId)) return;
    autoCreateTried.add(userId);
    void ensureWallet().catch(() => {
      autoCreateTried.delete(userId);
    });
  }, [ready, userId, wallet, creating, ensureWallet]);

  return { ready, wallet, creating, createError, ensureWallet };
}

export function WalletDesk() {
  if (!PRIVY_APP_ID) {
    return (
      <div className="wallet-desk">
        <div className="wallet-state">
          <p className="eyebrow">Wallet</p>
          <h2>Sign-in is not configured</h2>
          <p className="quiet">Add the Privy app id to enable the embedded Solana wallet.</p>
        </div>
      </div>
    );
  }
  return <WalletDeskLive />;
}

function WalletDeskLive() {
  const { ready, wallet, creating, createError, ensureWallet } = useSolanaWallet();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const address = wallet?.address ?? "";

  const [portfolio, setPortfolio] = useState<WalletPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [draft, setDraft] = useState<SendDraft | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus | null>(null);
  const [selectedMint, setSelectedMint] = useState("SOL");

  const holdings = portfolio?.holdings ?? [];
  const selected = useMemo(
    () => holdings.find((item) => item.mint === selectedMint || item.id === selectedMint) || holdings[0] || null,
    [holdings, selectedMint],
  );

  const refresh = useCallback(
    async (soft = false) => {
      if (!address) return;
      if (soft) setRefreshing(true);
      else setLoading(true);
      setError("");
      const controller = new AbortController();
      try {
        const next = await loadWalletPortfolio(address, controller.signal);
        setPortfolio(next);
        track({ name: "wallet_refresh", meta: { holdings: next.holdings.length } });
      } catch (caught) {
        setError(explainWalletError(caught));
        track({ name: "wallet_refresh", ok: false, error: explainWalletError(caught) });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [address],
  );

  useEffect(() => {
    if (!address) {
      setPortfolio(null);
      setLoading(false);
      return;
    }
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 45_000);
    return () => window.clearInterval(timer);
  }, [address, refresh]);

  useEffect(() => {
    if (createError) setError(createError);
  }, [createError]);

  async function retryCreateWallet() {
    setError("");
    try {
      await ensureWallet();
    } catch {
      /* ensureWallet already records the error */
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Clipboard is blocked in this browser. Select the address and copy it manually.");
    }
  }

  function openSend(holding?: WalletHolding) {
    const asset = holding || selected;
    if (!asset) return;
    setSelectedMint(asset.mint);
    setDraft({
      mint: asset.mint,
      kind: asset.kind,
      to: "",
      amount: "",
      decimals: asset.decimals,
      symbol: asset.symbol,
      tokenAccount: asset.tokenAccount,
      programId: asset.programId,
    });
    setSendStatus(null);
    setSheet("send");
  }

  function openReceive() {
    setSheet("receive");
  }

  function goReview() {
    if (!draft) return;
    if (!isSolanaAddress(draft.to)) {
      setError("Enter a valid Solana destination address.");
      return;
    }
    if (!draft.amount.trim()) {
      setError("Enter an amount to send.");
      return;
    }
    setError("");
    setSheet("review");
  }

  async function confirmSend() {
    if (!wallet || !draft || !portfolio) return;
    setSheet("status");
    setSendStatus({ phase: "signing", summary: `Preparing ${draft.amount} ${draft.symbol}` });
    const controller = new AbortController();
    try {
      const built = await buildTransferTransaction({
        from: wallet.address,
        draft,
        availableLamports: portfolio.lamports,
      });
      setSendStatus({ phase: "signing", summary: built.summary });
      const result = await signAndSendTransaction({
        transaction: built.transaction,
        wallet,
        chain: "solana:mainnet",
        options: {
          uiOptions: { showWalletUIs: true },
          optimisticBroadcast: true,
        },
      });
      const signature = signatureFromBytes(result.signature);
      setSendStatus({ phase: "confirming", summary: built.summary, signature });
      track({ name: "wallet_send", meta: { kind: draft.kind, symbol: draft.symbol } });
      const outcome = await waitForSignature(signature, controller.signal);
      setSendStatus({
        phase: outcome === "failed" ? "failed" : outcome === "confirmed" ? "confirmed" : "pending",
        summary: built.summary,
        signature,
        error: outcome === "failed" ? "The network reported this transfer as failed." : undefined,
      });
      void refresh(true);
    } catch (caught) {
      const message = explainWalletError(caught);
      setSendStatus({ phase: "failed", summary: draft.amount ? `Send ${draft.amount} ${draft.symbol}` : "Send", error: message });
      track({ name: "wallet_send", ok: false, error: message });
    }
  }

  if (!ready || (!wallet && creating)) {
    return (
      <div className="wallet-desk">
        <div className="wallet-state">
          <p className="eyebrow">Wallet</p>
          <h2>{creating ? "Creating your Solana wallet" : "Preparing your Solana wallet"}</h2>
          <p className="quiet">Privy is finishing sign-in and embedded wallet setup.</p>
        </div>
      </div>
    );
  }

  if (!wallet) {
    return (
      <div className="wallet-desk">
        <div className="wallet-state">
          <p className="eyebrow">Wallet</p>
          <h2>Create your Solana wallet</h2>
          <p className="quiet">
            KaziTrust uses a Privy embedded Solana wallet. It can receive SOL and any SPL token sent to your address.
          </p>
          {error ? <p className="wallet-error" role="alert">{error}</p> : null}
          <button type="button" className="btn ink" disabled={creating} onClick={() => void retryCreateWallet()}>
            {creating ? "Creating…" : "Create wallet"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-desk">
      <header className="wallet-hero">
        <div className="wallet-hero-top">
          <p className="eyebrow">Portfolio</p>
          <button type="button" className="text-btn" disabled={refreshing || loading} onClick={() => void refresh(true)}>
            {refreshing ? "Updating…" : "Refresh"}
          </button>
        </div>
        <p className="wallet-balance">{loading && !portfolio ? "…" : `${portfolio?.holdings[0]?.amountText ?? "0"} SOL`}</p>
        <div className="wallet-address-row">
          <span className="num" title={address}>
            {shortAddress(address)}
          </span>
          <button type="button" className="icon-btn tiny" aria-label="Copy wallet address" onClick={() => void copyAddress()}>
            <IconCopy size={14} />
          </button>
          {copied ? <span className="wallet-copied">Copied</span> : null}
        </div>
        <div className="wallet-actions">
          <button type="button" className="wallet-action" onClick={openReceive}>
            Receive
          </button>
          <button type="button" className="wallet-action primary" onClick={() => openSend()}>
            <IconSend size={16} />
            Send
          </button>
        </div>
      </header>

      {error && sheet === "none" ? (
        <p className="wallet-error" role="alert">
          {error}
        </p>
      ) : null}

      <section className="wallet-section">
        <div className="wallet-section-head">
          <h3>Assets</h3>
          <p className="quiet">{holdings.length ? `${holdings.length} holding${holdings.length === 1 ? "" : "s"}` : "Loading"}</p>
        </div>
        {loading && !portfolio ? (
          <p className="quiet">Reading balances from Solana…</p>
        ) : (
          <ul className="wallet-assets">
            {holdings.map((holding) => (
              <li key={holding.id}>
                <button type="button" className="wallet-asset" onClick={() => openSend(holding)}>
                  <span className="wallet-asset-mark" aria-hidden="true">
                    {holding.image ? <img src={holding.image} alt="" /> : holding.symbol.slice(0, 1)}
                  </span>
                  <span className="wallet-asset-copy">
                    <strong>{holding.symbol}</strong>
                    <span>{holding.name}</span>
                  </span>
                  <span className="wallet-asset-amt num">{holding.amountText}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wallet-section">
        <div className="wallet-section-head">
          <h3>Activity</h3>
          <a className="quiet-link" href={explorerAddress(address)} target="_blank" rel="noreferrer">
            Explorer
          </a>
        </div>
        {!portfolio?.activity.length ? (
          <p className="quiet">No recent signatures yet. Receive SOL or a token to see activity here.</p>
        ) : (
          <ul className="wallet-activity">
            {portfolio.activity.map((item) => (
              <li key={item.signature}>
                <a href={explorerTx(item.signature)} target="_blank" rel="noreferrer">
                  <span className={`wallet-dot ${item.err ? "bad" : "ok"}`} aria-hidden="true" />
                  <span className="wallet-activity-copy">
                    <strong>{item.err ? "Failed" : "Confirmed"}</strong>
                    <span className="num">{shortAddress(item.signature)}</span>
                  </span>
                  <span className="quiet">{item.blockTime ? formatTime(item.blockTime) : "—"}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="wallet-footnote quiet">
        Transfers on Solana cannot be reversed. Keep a little SOL for fees. This embedded wallet is created by Privy for
        your signed-in account.
      </p>

      {sheet !== "none" ? (
        <div className="wallet-sheet" role="dialog" aria-modal="true">
          <button type="button" className="wallet-sheet-scrim" aria-label="Close" onClick={() => setSheet("none")} />
          <div className="wallet-sheet-panel">
            {sheet === "receive" ? (
              <>
                <header className="wallet-sheet-head">
                  <h3>Receive</h3>
                  <button type="button" className="text-btn" onClick={() => setSheet("none")}>
                    Close
                  </button>
                </header>
                <p className="quiet">Share this Solana address to receive SOL or any SPL token.</p>
                <div className="wallet-receive-card">
                  <p className="num wallet-receive-address">{address}</p>
                  <button type="button" className="btn" onClick={() => void copyAddress()}>
                    {copied ? "Copied" : "Copy address"}
                  </button>
                </div>
                <p className="quiet">Only send Solana-network assets here. Assets from other chains will not arrive.</p>
              </>
            ) : null}

            {sheet === "send" && draft ? (
              <>
                <header className="wallet-sheet-head">
                  <h3>Send</h3>
                  <button type="button" className="text-btn" onClick={() => setSheet("none")}>
                    Close
                  </button>
                </header>
                <label className="wallet-field">
                  <span>Asset</span>
                  <select
                    value={draft.mint}
                    onChange={(event) => {
                      const holding = holdings.find((item) => item.mint === event.target.value);
                      if (!holding) return;
                      setDraft({
                        mint: holding.mint,
                        kind: holding.kind,
                        to: draft.to,
                        amount: "",
                        decimals: holding.decimals,
                        symbol: holding.symbol,
                        tokenAccount: holding.tokenAccount,
                        programId: holding.programId,
                      });
                    }}
                  >
                    {holdings.map((holding) => (
                      <option key={holding.id} value={holding.mint}>
                        {holding.symbol} · {holding.amountText}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="wallet-field">
                  <span>Destination</span>
                  <input
                    value={draft.to}
                    onChange={(event) => setDraft({ ...draft, to: event.target.value.trim() })}
                    placeholder="Solana address"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <label className="wallet-field">
                  <span>Amount</span>
                  <div className="wallet-amount">
                    <input
                      value={draft.amount}
                      onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                      placeholder="0.00"
                      inputMode="decimal"
                    />
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => {
                        const holding = holdings.find((item) => item.mint === draft.mint);
                        if (!holding) return;
                        if (holding.kind === "sol") {
                          const keep = 0.002;
                          const max = Math.max(0, holding.amount - keep);
                          setDraft({ ...draft, amount: max > 0 ? String(max) : "0" });
                          return;
                        }
                        setDraft({ ...draft, amount: holding.amountText });
                      }}
                    >
                      Max
                    </button>
                  </div>
                </label>
                {error ? <p className="wallet-error">{error}</p> : null}
                <button type="button" className="btn ink" onClick={goReview}>
                  Review
                </button>
              </>
            ) : null}

            {sheet === "review" && draft ? (
              <>
                <header className="wallet-sheet-head">
                  <h3>Confirm</h3>
                  <button type="button" className="text-btn" onClick={() => setSheet("send")}>
                    Back
                  </button>
                </header>
                <dl className="wallet-review">
                  <div>
                    <dt>You send</dt>
                    <dd>
                      {draft.amount} {draft.symbol}
                    </dd>
                  </div>
                  <div>
                    <dt>To</dt>
                    <dd className="num">{draft.to}</dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd>Solana</dd>
                  </div>
                </dl>
                <p className="quiet">Transfers cannot be reversed. Privy will ask you to approve the signature.</p>
                <button type="button" className="btn ink" onClick={() => void confirmSend()}>
                  Confirm and sign
                </button>
              </>
            ) : null}

            {sheet === "status" && sendStatus ? (
              <>
                <header className="wallet-sheet-head">
                  <h3>
                    {sendStatus.phase === "confirmed"
                      ? "Sent"
                      : sendStatus.phase === "failed"
                        ? "Could not send"
                        : sendStatus.phase === "pending"
                          ? "Submitted"
                          : "Sending"}
                  </h3>
                  <button type="button" className="text-btn" onClick={() => setSheet("none")}>
                    Close
                  </button>
                </header>
                <p>{sendStatus.summary}</p>
                {sendStatus.error ? <p className="wallet-error">{sendStatus.error}</p> : null}
                {sendStatus.signature ? (
                  <a className="quiet-link" href={explorerTx(sendStatus.signature)} target="_blank" rel="noreferrer">
                    View on Solscan · {shortAddress(sendStatus.signature)}
                  </a>
                ) : null}
                {sendStatus.phase === "signing" || sendStatus.phase === "confirming" ? (
                  <p className="quiet">Waiting on the network…</p>
                ) : null}
                {sendStatus.phase === "failed" ? (
                  <button type="button" className="btn" onClick={() => setSheet("send")}>
                    Try again
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function HistoryWalletCard({
  go,
  active,
}: {
  go: (to: string) => void;
  active?: boolean;
}) {
  if (!PRIVY_APP_ID) {
    return (
      <button type="button" className="history-wallet" disabled>
        <span className="history-wallet-icon" aria-hidden="true">
          <IconWallet size={16} />
        </span>
        <span className="history-wallet-copy">
          <strong>Wallet</strong>
          <span>Unavailable</span>
        </span>
      </button>
    );
  }
  return <HistoryWalletCardLive go={go} active={active} />;
}

function HistoryWalletCardLive({ go, active }: { go: (to: string) => void; active?: boolean }) {
  const { ready, wallet, creating, createError } = useSolanaWallet();
  const address = wallet?.address || "";
  const detail = !ready
    ? "Preparing…"
    : creating
      ? "Creating wallet…"
      : address
        ? shortAddress(address)
        : createError
          ? "Tap to retry wallet"
          : "Create Solana wallet";

  return (
    <button
      type="button"
      className={`history-wallet ${active ? "current" : ""}`}
      onClick={() => go("/app/wallet")}
      aria-current={active ? "page" : undefined}
    >
      <span className="history-wallet-icon" aria-hidden="true">
        <IconWallet size={16} />
      </span>
      <span className="history-wallet-copy">
        <strong>Wallet</strong>
        <span className={address ? "num" : undefined} title={address || createError || undefined}>
          {detail}
        </span>
      </span>
    </button>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePrivy, type User } from "@privy-io/react-auth";
import { useCreateWallet, useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana";
import { track } from "../analytics";
import {
  applyOptimisticSend,
  buildTransferTransaction,
  explainWalletError,
  explorerAddress,
  explorerTx,
  isSolanaAddress,
  loadWalletPortfolio,
  signatureFromBytes,
  waitForSignature,
  type SendDraft,
  type WalletActivity,
  type WalletHolding,
  type WalletPortfolio,
} from "../engine/wallet";
import { formatTime, shortAddress } from "../format";
import { QRCodeSVG } from "qrcode.react";
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconCheckCircle,
  IconChevronDown,
  IconChevronUp,
  IconClose,
  IconCopy,
  IconFilter,
  IconSend,
  IconSpinner,
  IconXCircle,
} from "./icons";
import { Mark } from "./mark";
import { loadWalletActivity, mergeWalletActivity, saveWalletActivity } from "../storage";

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID ?? "";
const autoCreateTried = new Set<string>();
const CREATE_MIN_MS = 2200;
const READY_HOLD_MS = 2800;
const ACTIVITY_STACK = 7;

type Sheet = "none" | "receive" | "send" | "review" | "status";
type CreatePhase = "idle" | "creating" | "ready" | "error";
type ActivityFilter = "all" | "in" | "out" | "failed";

type SendStatus = {
  phase: "signing" | "confirming" | "confirmed" | "pending" | "failed";
  summary: string;
  signature?: string;
  error?: string;
};

type WalletEnsureValue = {
  ready: boolean;
  wallet: ReturnType<typeof useWallets>["wallets"][number] | null;
  creating: boolean;
  createError: string;
  ensureWallet: () => Promise<void>;
};

const WalletEnsureContext = createContext<WalletEnsureValue | null>(null);

function userHasSolanaWallet(user: User | null | undefined): boolean {
  if (!user?.linkedAccounts?.length) return false;
  return user.linkedAccounts.some((account) => {
    if (account.type !== "wallet") return false;
    const chainType = "chainType" in account ? String(account.chainType ?? "") : "";
    return chainType === "solana";
  });
}

function useSolanaWallet(): WalletEnsureValue {
  const context = useContext(WalletEnsureContext);
  const { ready, wallets } = useWallets();
  const wallet = wallets[0] ?? null;
  if (context) return context;
  return {
    ready,
    wallet,
    creating: false,
    createError: "",
    ensureWallet: async () => undefined,
  };
}

export function SolanaWalletEnsure({ children }: { children: ReactNode }) {
  if (!PRIVY_APP_ID) return children;
  return <SolanaWalletEnsureLive>{children}</SolanaWalletEnsureLive>;
}

function SolanaWalletEnsureLive({ children }: { children: ReactNode }) {
  const { ready: authReady, authenticated, user } = usePrivy();
  const { ready, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const userId = user?.id ?? null;
  const wallet = wallets[0] ?? null;
  const linkedSolana = userHasSolanaWallet(user);
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const [createError, setCreateError] = useState("");
  const createLock = useRef(false);
  const startedAt = useRef<number | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const dismissTimer = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (advanceTimer.current != null) {
      window.clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
    if (dismissTimer.current != null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  }, []);

  const showReadyThenClose = useCallback(() => {
    clearTimers();
    const elapsed = Date.now() - (startedAt.current ?? Date.now());
    const wait = Math.max(0, CREATE_MIN_MS - elapsed);
    advanceTimer.current = window.setTimeout(() => {
      setPhase("ready");
      dismissTimer.current = window.setTimeout(() => {
        setPhase("idle");
        startedAt.current = null;
        dismissTimer.current = null;
      }, READY_HOLD_MS);
      advanceTimer.current = null;
    }, wait);
  }, [clearTimers]);

  const ensureWallet = useCallback(async () => {
    if (wallet || linkedSolana || createLock.current) return;
    createLock.current = true;
    clearTimers();
    startedAt.current = Date.now();
    setPhase("creating");
    setCreateError("");
    try {
      await createWallet();
      track({ name: "wallet_create", ok: true });
      showReadyThenClose();
    } catch (caught) {
      const message = explainWalletError(caught);
      // Privy may throw when the wallet already exists for this account.
      if (/already|exist/i.test(message)) {
        showReadyThenClose();
        return;
      }
      setCreateError(message);
      setPhase("error");
      track({ name: "wallet_create", ok: false, error: message });
      throw caught;
    } finally {
      createLock.current = false;
    }
  }, [wallet, linkedSolana, createWallet, clearTimers, showReadyThenClose]);

  useEffect(() => {
    clearTimers();
    startedAt.current = null;
    setCreateError("");
    setPhase("idle");
  }, [userId, clearTimers]);

  useEffect(() => {
    if (!authReady || !authenticated || !ready || !userId) return;
    if (wallet || linkedSolana) return;
    if (phase === "creating" || phase === "error" || createLock.current) return;
    if (autoCreateTried.has(userId)) return;
    autoCreateTried.add(userId);
    void ensureWallet().catch(() => {
      autoCreateTried.delete(userId);
    });
  }, [authReady, authenticated, ready, userId, wallet, linkedSolana, phase, ensureWallet]);

  useEffect(() => {
    if (!(wallet || linkedSolana)) return;
    if (phase !== "creating") return;
    showReadyThenClose();
  }, [wallet, linkedSolana, phase, showReadyThenClose]);

  useEffect(() => {
    if (phase !== "creating") return;
    const timer = window.setTimeout(() => {
      if (wallet || linkedSolana) return;
      setCreateError("Wallet creation is taking longer than expected. Try again.");
      setPhase("error");
      if (userId) autoCreateTried.delete(userId);
    }, 25_000);
    return () => window.clearTimeout(timer);
  }, [phase, wallet, linkedSolana, userId]);

  const value = useMemo<WalletEnsureValue>(
    () => ({
      ready: Boolean(ready && authReady && (!linkedSolana || wallet)),
      wallet,
      creating: phase === "creating",
      createError,
      ensureWallet: async () => {
        if (userId) autoCreateTried.delete(userId);
        await ensureWallet();
      },
    }),
    [ready, authReady, linkedSolana, wallet, phase, createError, ensureWallet, userId],
  );

  const showModal = authenticated && (phase === "creating" || phase === "ready" || phase === "error");

  return (
    <WalletEnsureContext.Provider value={value}>
      {children}
      {showModal ? (
        <div className="wallet-create-layer" role="dialog" aria-modal="true" aria-labelledby="wallet-create-title">
          <div className="wallet-create-scrim" />
          <div className="wallet-create-panel privy-like">
            <div
              className={`wallet-create-mark ${phase === "ready" ? "done" : phase === "error" ? "fail" : "spin"}`}
              aria-hidden="true"
            >
              {phase === "ready" ? (
                <IconCheckCircle size={28} />
              ) : phase === "error" ? (
                <IconAlertCircle size={28} />
              ) : (
                <IconSpinner size={28} />
              )}
            </div>
            <h2 id="wallet-create-title">
              {phase === "ready" ? "All set!" : phase === "error" ? "Something went wrong" : "Creating your wallet"}
            </h2>
            <p className="quiet">
              {phase === "ready"
                ? "Your account is secured with a Solana wallet."
                : phase === "error"
                  ? createError || "Privy could not finish creating the embedded wallet."
                  : "Please wait…"}
            </p>
            {phase === "error" ? (
              <button
                type="button"
                className="btn ink"
                onClick={() => {
                  void value.ensureWallet().catch(() => undefined);
                }}
              >
                Try again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </WalletEnsureContext.Provider>
  );
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
  const { user } = usePrivy();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  const address = wallet?.address ?? "";
  const userId = user?.id ?? null;

  const [portfolio, setPortfolio] = useState<WalletPortfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<Sheet>("none");
  const [draft, setDraft] = useState<SendDraft | null>(null);
  const [sendStatus, setSendStatus] = useState<SendStatus | null>(null);
  const [selectedMint, setSelectedMint] = useState("SOL");
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");
  const [activityExpanded, setActivityExpanded] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement | null>(null);

  const holdings = portfolio?.holdings ?? [];
  const selected = useMemo(
    () => holdings.find((item) => item.mint === selectedMint || item.id === selectedMint) || holdings[0] || null,
    [holdings, selectedMint],
  );

  const persistActivity = useCallback(
    (items: WalletActivity[]) => {
      if (!userId || !address) return;
      saveWalletActivity(userId, address, items);
    },
    [userId, address],
  );

  const rememberActivity = useCallback(
    (entry: WalletActivity) => {
      setPortfolio((current) => {
        if (!current) {
          const activity = mergeWalletActivity([entry], loadWalletActivity(userId, address));
          persistActivity(activity);
          return {
            address,
            lamports: 0,
            sol: 0,
            totalSolValue: 0,
            totalSolValueText: "0",
            holdings: [],
            activity,
            updatedAt: Date.now(),
          };
        }
        const activity = mergeWalletActivity(current.activity, [entry]);
        persistActivity(activity);
        return { ...current, activity, updatedAt: Date.now() };
      });
    },
    [address, persistActivity, userId],
  );

  const refresh = useCallback(
    async (mode: "hard" | "soft" | "quiet" = "hard") => {
      if (!address) return;
      if (mode === "soft") setRefreshing(true);
      else if (mode === "hard") setLoading(true);
      setError("");
      const controller = new AbortController();
      try {
        const next = await loadWalletPortfolio(address, controller.signal);
        const cached = loadWalletActivity(userId, address);
        const activity = mergeWalletActivity(cached, next.activity);
        persistActivity(activity);
        setPortfolio({ ...next, activity });
        track({ name: "wallet_refresh", meta: { holdings: next.holdings.length, activity: activity.length } });
      } catch (caught) {
        setError(explainWalletError(caught));
        track({ name: "wallet_refresh", ok: false, error: explainWalletError(caught) });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [address, persistActivity, userId],
  );

  useEffect(() => {
    if (!address) {
      setPortfolio(null);
      setLoading(false);
      setActivityExpanded(false);
      setFilterOpen(false);
      return;
    }
    const cached = loadWalletActivity(userId, address);
    if (cached.length) {
      setPortfolio({
        address,
        lamports: 0,
        sol: 0,
        totalSolValue: 0,
        totalSolValueText: "0",
        holdings: [],
        activity: cached,
        updatedAt: 0,
      });
    } else {
      setPortfolio(null);
    }
    void refresh("hard");
    const timer = window.setInterval(() => void refresh("quiet"), 45_000);
    return () => window.clearInterval(timer);
  }, [address, refresh, userId]);

  useEffect(() => {
    if (!filterOpen) return;
    function onPointer(event: MouseEvent) {
      if (!filterRef.current?.contains(event.target as Node)) setFilterOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setFilterOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [filterOpen]);

  const filteredActivity = useMemo(() => {
    const rows = portfolio?.activity ?? [];
    if (activityFilter === "failed") return rows.filter((item) => item.failed);
    if (activityFilter === "in") return rows.filter((item) => !item.failed && item.direction === "in");
    if (activityFilter === "out") return rows.filter((item) => !item.failed && item.direction === "out");
    return rows;
  }, [portfolio?.activity, activityFilter]);

  const visibleActivity = activityExpanded ? filteredActivity : filteredActivity.slice(0, ACTIVITY_STACK);
  const hiddenActivityCount = Math.max(0, filteredActivity.length - ACTIVITY_STACK);

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
      const entry: WalletActivity = {
        signature,
        slot: 0,
        err: outcome === "failed" ? { message: "failed" } : null,
        blockTime: Math.floor(Date.now() / 1000),
        failed: outcome === "failed",
        direction: outcome === "failed" ? "unknown" : "out",
        title: outcome === "failed" ? "Failed transfer" : `Sent ${draft.symbol}`,
        detail: outcome === "failed" ? "This transaction did not land" : "Token left this wallet",
        amountText: outcome === "failed" ? undefined : `−${draft.amount} ${draft.symbol}`,
        symbol: draft.symbol,
        image: draft.kind === "sol" ? "/logos/solana.svg" : draft.symbol === "USDC" ? "/logos/usdc.svg" : undefined,
      };
      if (outcome !== "failed") {
        setPortfolio((current) => {
          if (!current) return current;
          const next = applyOptimisticSend(current, draft);
          const activity = mergeWalletActivity(next.activity, [entry]);
          persistActivity(activity);
          return { ...next, activity };
        });
        void refresh("quiet");
        window.setTimeout(() => void refresh("quiet"), 2200);
      } else {
        rememberActivity(entry);
      }
    } catch (caught) {
      const message = explainWalletError(caught);
      setSendStatus({ phase: "failed", summary: draft.amount ? `Send ${draft.amount} ${draft.symbol}` : "Send", error: message });
      track({ name: "wallet_send", ok: false, error: message });
      rememberActivity({
        signature: `local-fail-${Date.now()}`,
        slot: 0,
        err: { message },
        blockTime: Math.floor(Date.now() / 1000),
        failed: true,
        direction: "unknown",
        title: "Failed transfer",
        detail: message.slice(0, 120) || "This transaction did not land",
        symbol: draft.symbol,
      });
    }
  }

  if (!ready || (!wallet && creating) || refreshing || (loading && !portfolio)) {
    return (
      <div className="wallet-desk wallet-desk-wait">
        <WalletLogoWait label={!ready || creating ? "Preparing wallet" : "Updating wallet"} />
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
          <p className="eyebrow">Available balance</p>
          <button type="button" className="text-btn" disabled={refreshing || loading} onClick={() => void refresh("soft")}>
            Refresh
          </button>
        </div>
        <p className="wallet-balance">
          {loading && !portfolio ? "…" : `${portfolio?.totalSolValueText ?? "0"} SOL`}
        </p>
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
        </div>
        {loading && !portfolio ? (
          <p className="quiet">Reading balances from Solana…</p>
        ) : (
          <ul className="wallet-assets">
            {holdings.map((holding) => (
              <li key={holding.id}>
                <button type="button" className="wallet-asset" onClick={() => openSend(holding)}>
                  <AssetMark holding={holding} />
                  <span className="wallet-asset-copy">
                    <strong>{holding.symbol}</strong>
                    <span>{holding.name}</span>
                  </span>
                  <span className="wallet-asset-amt">
                    <strong className="num">{holding.amountText}</strong>
                    <span className="num">{holding.solValueText ? `${holding.solValueText} SOL` : "—"}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="wallet-section">
        <div className="wallet-section-head">
          <h3>Recent activity</h3>
          <div className="wallet-section-tools">
            <div className="wallet-filter" ref={filterRef}>
              <button
                type="button"
                className={`icon-btn tiny ${filterOpen || activityFilter !== "all" ? "active" : ""}`}
                aria-label="Filter activity"
                aria-expanded={filterOpen}
                aria-haspopup="menu"
                onClick={() => setFilterOpen((open) => !open)}
              >
                <IconFilter size={15} />
              </button>
              {filterOpen ? (
                <div className="wallet-filter-menu" role="menu">
                  {(
                    [
                      ["all", "All"],
                      ["in", "Received"],
                      ["out", "Sent"],
                      ["failed", "Failed"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={activityFilter === value}
                      className={activityFilter === value ? "active" : ""}
                      onClick={() => {
                        setActivityFilter(value);
                        setActivityExpanded(false);
                        setFilterOpen(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <a className="quiet-link" href={explorerAddress(address)} target="_blank" rel="noreferrer">
              Hash
            </a>
          </div>
        </div>
        {filteredActivity.length ? (
          <>
            <ul className="wallet-activity">
              {visibleActivity.map((item) => {
                const localOnly = item.signature.startsWith("local-");
                const row = (
                  <>
                    <ActivityMark item={item} />
                    <span className="wallet-activity-copy">
                      <strong>{item.title}</strong>
                      <span>{item.detail}</span>
                    </span>
                    <span className="wallet-activity-meta">
                      {item.amountText ? <strong className={`num ${item.direction}`}>{item.amountText}</strong> : null}
                      <span className="quiet">{item.blockTime ? formatTime(item.blockTime) : "Pending"}</span>
                    </span>
                  </>
                );
                return (
                  <li key={item.signature}>
                    {localOnly ? (
                      <div className={`wallet-activity-row ${item.direction} ${item.failed ? "failed" : ""}`}>{row}</div>
                    ) : (
                      <a
                        className={`wallet-activity-row ${item.direction} ${item.failed ? "failed" : ""}`}
                        href={explorerTx(item.signature)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row}
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            {hiddenActivityCount > 0 ? (
              <button
                type="button"
                className="wallet-activity-expand"
                onClick={() => setActivityExpanded((open) => !open)}
              >
                {activityExpanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
                <span>{activityExpanded ? "Show less" : `Show ${hiddenActivityCount} more`}</span>
              </button>
            ) : null}
          </>
        ) : (
          <p className="quiet wallet-activity-empty">
            {activityFilter === "all"
              ? "Received and failed transfers will stay here after you sign in again."
              : "No transfers match this filter."}
          </p>
        )}
      </section>

      {sheet !== "none" ? (
        <div className="wallet-sheet" role="dialog" aria-modal="true">
          <button type="button" className="wallet-sheet-scrim" aria-label="Close" onClick={() => setSheet("none")} />
          <div className="wallet-sheet-panel">
            {sheet === "receive" ? (
              <div className="wallet-receive">
                <header className="wallet-sheet-head">
                  <div className="wallet-receive-heading">
                    <h3>Receive</h3>
                    <p className="quiet">Send only tokens on Solana Network</p>
                    <ul className="wallet-receive-assets">
                      <li>
                        <img src="/logos/solana.svg" alt="" width={18} height={18} />
                        <span>Solana</span>
                      </li>
                      <li>
                        <img src="/logos/usdc.svg" alt="" width={18} height={18} />
                        <span>USDC on Solana</span>
                      </li>
                    </ul>
                  </div>
                  <button type="button" className="icon-btn" aria-label="Close" onClick={() => setSheet("none")}>
                    <IconClose size={18} />
                  </button>
                </header>
                <div className="wallet-receive-qr">
                  <QRCodeSVG value={address} size={176} level="M" marginSize={0} bgColor="#ffffff" fgColor="#0b0c0e" />
                </div>
                <div className="wallet-receive-card">
                  <span className="wallet-receive-label">Address</span>
                  <p className="num wallet-receive-address">{address}</p>
                  <button type="button" className="btn ink wallet-receive-copy" onClick={() => void copyAddress()}>
                    <IconCopy size={16} />
                    {copied ? "Copied" : "Copy address"}
                  </button>
                </div>
                <p className="wallet-receive-note quiet">Only send assets on Solana. Tokens from other chains will not arrive.</p>
              </div>
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

function WalletLogoWait({ label }: { label: string }) {
  return (
    <div className="wallet-logo-wait" role="status" aria-live="polite" aria-label={label}>
      <span className="wallet-logo-wait-mark" aria-hidden="true">
        <Mark size={64} />
      </span>
    </div>
  );
}

function ActivityMark({ item }: { item: WalletActivity }) {
  if (item.failed) {
    return (
      <span className="wallet-activity-mark failed" aria-hidden="true">
        <IconXCircle size={22} />
      </span>
    );
  }

  if (item.image) {
    return (
      <span className={`wallet-activity-mark ${item.direction} has-logo`} aria-hidden="true">
        <img
          src={item.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }

  return (
    <span className={`wallet-activity-mark ${item.direction}`} aria-hidden="true">
      {item.direction === "in" ? (
        <IconArrowDown size={20} />
      ) : item.direction === "out" ? (
        <IconArrowUp size={20} />
      ) : (
        <IconCheckCircle size={22} />
      )}
    </span>
  );
}

function AssetMark({ holding }: { holding: WalletHolding }) {
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(holding.image) && !broken;
  return (
    <span className={`wallet-asset-mark ${showImage ? "has-logo" : ""}`} aria-hidden="true">
      {showImage ? (
        <img
          src={holding.image}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        holding.symbol.slice(0, 1)
      )}
    </span>
  );
}

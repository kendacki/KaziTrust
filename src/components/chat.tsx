import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { readAttachment } from "../engine/attach";
import { extractAddresses } from "../engine/address";
import { investigate } from "../engine/analyze";
import { downloadChatPdf } from "../engine/chat-pdf";
import { walletQuestionAllowed } from "../engine/scope";
import { readQuota } from "../engine/quota";
import { cautionLabel, shortAddress } from "../format";
import { cleanUsername, initials, loadThreads, loadUsername, loadWatch, saveThreads, saveUsername, saveWatch, type Thread, type ThreadMessage, type WatchItem } from "../storage";
import type { Finding, Report, Visual } from "../types";
import {
  IconAttach,
  IconClose,
  IconCompose,
  IconCopy,
  IconEdit,
  IconExport,
  IconKey,
  IconPin,
  IconSearch,
  IconSend,
  IconSidebar,
  IconSignOut,
  IconStop,
  IconTrash,
} from "./icons";
import { ApiDesk } from "./api";
import { Lockup } from "./mark";
import { EvidenceList, ReportView, reportPlainText } from "./report";
import { VisualView, visualTitle } from "./visuals";

type Panel =
  | { kind: "visual"; visual: Visual }
  | { kind: "evidence"; finding: Finding }
  | null;

function titleFrom(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 40)}…` : clean;
}

function contextAddresses(messages: ThreadMessage[]): string[] {
  const found: string[] = [];
  for (const message of messages) {
    for (const address of extractAddresses(message.content)) {
      if (!found.includes(address)) found.push(address);
    }
    const watched = message.report?.watchAddress;
    if (watched && !found.includes(watched)) found.push(watched);
  }
  return found;
}

export function Chat({ go, api = false }: { go: (to: string) => void; api?: boolean }) {
  const { logout, user } = usePrivy();
  const [threads, setThreads] = useState<Thread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [watch, setWatch] = useState<WatchItem[]>(() => loadWatch());
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [filter, setFilter] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebar, setSidebar] = useState(() => window.matchMedia("(min-width: 961px)").matches);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [rename, setRename] = useState<string | null>(null);
  const [quota, setQuota] = useState(() => readQuota());
  const [username, setUsername] = useState(() => loadUsername() ?? "");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const threadsRef = useRef(threads);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  threadsRef.current = threads;

  useEffect(() => saveThreads(threads), [threads]);
  useEffect(() => saveWatch(watch), [watch]);
  useEffect(() => {
    if (username) saveUsername(username);
  }, [username]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = threads.find((thread) => thread.id === activeId) ?? null;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages.length, active?.messages.at(-1)?.steps?.length, active?.messages.at(-1)?.report]);

  const booted = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const address = params.get("address");
    const q = params.get("q");
    const text = q || (address ? `Read ${address}` : "");
    if (!text) return;
    const timer = window.setTimeout(() => {
      if (booted.current) return;
      booted.current = true;
      window.history.replaceState({}, "", "/app");
      void submit(text);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function upsert(thread: Thread) {
    setThreads((current) => {
      const rest = current.filter((item) => item.id !== thread.id);
      return [thread, ...rest];
    });
    setActiveId(thread.id);
  }

  function patchMessage(threadId: string, messageId: string, patch: (message: ThreadMessage) => ThreadMessage) {
    setThreads((current) =>
      current.map((thread) =>
        thread.id === threadId
          ? { ...thread, updatedAt: Date.now(), messages: thread.messages.map((message) => (message.id === messageId ? patch(message) : message)) }
          : thread,
      ),
    );
  }

  async function submit(text: string, reuse?: { threadId: string; userId: string }) {
    const content = text.trim();
    if (!content || busy) return;
    if (/^add to watchlist/i.test(content)) {
      const thread = threadsRef.current.find((item) => item.id === (reuse?.threadId ?? activeId));
      const report = [...(thread?.messages ?? [])].reverse().find((message) => message.report)?.report;
      if (report) pin(report);
      const note: ThreadMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: report?.watchAddress ? `Pinned ${shortAddress(report.watchAddress)} on this device.` : "Read a wallet first, then pin it.",
      };
      const base = thread ?? blankThread(content);
      upsert({ ...base, messages: [...base.messages, { id: crypto.randomUUID(), role: "user", content }, note], updatedAt: Date.now() });
      setDraft("");
      return;
    }

    const existing = threadsRef.current.find((item) => item.id === (reuse?.threadId ?? activeId));
    const base = existing ?? blankThread(content);
    let messages = base.messages;
    if (reuse) {
      const index = messages.findIndex((message) => message.id === reuse.userId);
      const current = messages[index];
      if (!current) return;
      const changed = current.content !== content;
      messages = [
        ...messages.slice(0, index),
        {
          ...current,
          content,
          earlier: changed ? [...(current.earlier ?? []), { content: current.content, after: messages.slice(index + 1) }] : current.earlier,
        },
      ];
    } else {
      messages = [...messages, { id: crypto.randomUUID(), role: "user", content }];
    }
    const assistantId = crypto.randomUUID();
    messages = [...messages, { id: assistantId, role: "assistant", content: "", steps: [] }];
    const thread: Thread = {
      ...base,
      title: base.messages.length ? base.title : titleFrom(content),
      messages,
      updatedAt: Date.now(),
    };
    upsert(thread);
    setDraft("");
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const prior = messages.filter((message) => message.id !== assistantId);
    try {
      const answer = await investigate({
        question: content,
        contextAddresses: contextAddresses(prior.slice(0, -1)),
        mode,
        signal: controller.signal,
        onStep: (label, state) => {
          patchMessage(thread.id, assistantId, (message) => {
            const steps = message.steps ?? [];
            const index = steps.findIndex((step) => step.label === label);
            const next =
              index === -1
                ? [...steps.map((step) => (step.state === "active" ? { ...step, state: "done" as const } : step)), { label, state }]
                : steps.map((step) => (step.label === label ? { label, state } : step));
            return { ...message, steps: next };
          });
        },
      });
      patchMessage(thread.id, assistantId, (message) =>
        answer.kind === "report"
          ? { ...message, content: answer.report.summary, report: answer.report, followups: answer.followups, steps: (message.steps ?? []).map((step) => ({ ...step, state: "done" })) }
          : { ...message, content: answer.text, followups: answer.followups, steps: (message.steps ?? []).map((step) => ({ ...step, state: "done" })) },
      );
    } catch (error) {
      const stopped = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      patchMessage(thread.id, assistantId, (message) => ({
        ...message,
        stopped,
        content: stopped ? "Stopped before a score was saved." : "The read failed.",
        steps: (message.steps ?? []).map((step) => ({ ...step, state: "done" })),
      }));
    } finally {
      setBusy(false);
      setQuota(readQuota());
      abortRef.current = null;
    }
  }

  function say(user: string, assistant: string) {
    const base = threadsRef.current.find((item) => item.id === activeId) ?? blankThread(user);
    upsert({
      ...base,
      title: base.messages.length ? base.title : titleFrom(user),
      messages: [
        ...base.messages,
        { id: crypto.randomUUID(), role: "user", content: user },
        { id: crypto.randomUUID(), role: "assistant", content: assistant },
      ],
      updatedAt: Date.now(),
    });
    setDraft("");
  }

  async function attachFile(file: File) {
    const result = await readAttachment(file);
    if (!result.ok) {
      say("Attached a file", result.message);
      return;
    }
    const note = draft.trim();
    const addresses = result.addresses.join("\n");
    const question =
      note && walletQuestionAllowed(note, false) ? `${note}\n\nRead these addresses:\n${addresses}` : `Read these addresses:\n${addresses}`;
    void submit(question);
  }

  function blankThread(content: string): Thread {
    return {
      id: crypto.randomUUID(),
      title: titleFrom(content),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pinned: false,
      messages: [],
    };
  }

  function pin(report: Report) {
    if (!report.watchAddress || !activeId) return;
    const address = report.watchAddress;
    const threadId = activeId;
    const saved = watch.some((item) => item.address === address);
    setWatch((current) => {
      if (saved) return current.filter((item) => item.address !== address);
      const previous = current.find((item) => item.address === address);
      const item: WatchItem = {
        address,
        label: report.typeGuess,
        score: report.riskScore,
        band: cautionLabel(report.kind, report.riskScore, report.band),
        previousScore: previous?.score,
        updatedAt: Date.now(),
      };
      return [item, ...current.filter((row) => row.address !== item.address)];
    });
    setThreads((current) =>
      current.map((thread) => (thread.id === threadId ? { ...thread, pinned: !saved, updatedAt: Date.now() } : thread)),
    );
  }

  function toggleHistory() {
    setSidebar((open) => !open);
  }

  function newChat() {
    setActiveId(null);
    setDraft("");
    setPanel(null);
    setMenu(null);
    setRename(null);
    if (window.innerWidth < 860) setSidebar(false);
    if (api) go("/app");
  }

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return threads.filter((thread) => {
      if (!q) return true;
      if (thread.title.toLowerCase().includes(q)) return true;
      return thread.messages.some((message) => message.content.toLowerCase().includes(q));
    });
  }, [threads, filter]);

  const groups = groupThreads(visible);
  const chips = extractAddresses(draft);

  return (
    <div className="app-shell" data-side={sidebar ? "open" : "closed"} data-panel={panel ? "open" : "closed"}>
      <aside className="sidebar" hidden={!sidebar}>
        <header className="side-top">
          <button type="button" className="lockup-btn" onClick={() => go("/")}>
            <Lockup size={28} />
          </button>
          <button type="button" className="icon-btn" aria-label="Hide history" onClick={toggleHistory}>
            <IconSidebar />
          </button>
        </header>
        <div className="history-tools">
          {searchOpen ? (
            <label className="search">
              <IconSearch size={16} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onBlur={() => {
                  if (!filter) setSearchOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setFilter("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="Search chats"
                aria-label="Search chats"
                autoFocus
              />
            </label>
          ) : (
            <button type="button" className="history-new" onClick={newChat}>
              <IconCompose size={16} />
              New chat
            </button>
          )}
          <button
            type="button"
            className="history-search"
            aria-label="Search chats"
            aria-pressed={searchOpen}
            onClick={() => {
              if (searchOpen) {
                setFilter("");
                setSearchOpen(false);
                return;
              }
              setSearchOpen(true);
            }}
          >
            <IconSearch size={16} />
          </button>
        </div>
        <div className="side-scroll">
          <p className="side-label">History</p>
          {Object.entries(groups).map(([label, items]) =>
            items.length ? (
              <section key={label}>
                <p className="history-group">{label}</p>
                <ul className="history">
                  {items.map((thread) => (
                    <li key={thread.id}>
                      {rename === thread.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            const data = new FormData(event.currentTarget);
                            const title = String(data.get("title") || thread.title);
                            setThreads((current) => current.map((item) => (item.id === thread.id ? { ...item, title } : item)));
                            setRename(null);
                          }}
                        >
                          <input name="title" defaultValue={thread.title} aria-label="Chat title" autoFocus />
                        </form>
                      ) : (
                        <button type="button" className={thread.id === activeId && !api ? "current" : ""} onClick={() => { setActiveId(thread.id); setPanel(null); if (api) go("/app"); if (window.innerWidth < 860) setSidebar(false); }}>
                          {thread.title}
                        </button>
                      )}
                      <button type="button" className="icon-btn tiny" aria-label="Chat actions" onClick={() => setMenu(menu === thread.id ? null : thread.id)}>
                        ···
                      </button>
                      {menu === thread.id ? (
                        <div className="row-menu" role="menu">
                          <button type="button" onClick={() => { setRename(thread.id); setMenu(null); }}>
                            <IconEdit size={14} /> Rename
                          </button>
                          <button type="button" onClick={() => { setThreads((current) => current.map((item) => item.id === thread.id ? { ...item, pinned: !item.pinned } : item)); setMenu(null); }}>
                            <IconPin size={14} /> {thread.pinned ? "Unpin" : "Pin"}
                          </button>
                          <button type="button" onClick={() => { navigator.clipboard.writeText(thread.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n")); setMenu(null); }}>
                            <IconCopy size={14} /> Copy
                          </button>
                          <button type="button" className="danger-text" onClick={() => { setThreads((current) => current.filter((item) => item.id !== thread.id)); if (activeId === thread.id) setActiveId(null); setMenu(null); }}>
                            <IconTrash size={14} /> Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </div>
        <footer className="account">
          <button type="button" className="api-entry" aria-current={api ? "page" : undefined} onClick={() => { setPanel(null); if (!api) go("/app/api"); if (window.innerWidth < 860) setSidebar(false); }}>
            <IconKey size={16} />
            API
          </button>
          <ProfileName
            name={username || user?.google?.name || user?.email?.address?.split("@")[0] || "Reader"}
            detail={`${quota.remaining} of ${quota.limit} live reads left today`}
            editing={editingName}
            draft={nameDraft}
            onDraft={setNameDraft}
            onStart={() => {
              setNameDraft(username || user?.google?.name || user?.email?.address?.split("@")[0] || "Reader");
              setEditingName(true);
            }}
            onCancel={() => setEditingName(false)}
            onSave={(next) => {
              if (next) setUsername(next);
              setEditingName(false);
            }}
            onSignOut={() => void logout()}
          />
        </footer>
      </aside>
      {api ? (
        <section className="thread thread-api">
          {sidebar ? null : (
            <header className="thread-top">
              <div className="thread-start">
                <button type="button" className="icon-btn" aria-label="Show history" onClick={toggleHistory}>
                  <IconSidebar />
                </button>
              </div>
            </header>
          )}
          <div className="thread-scroll">
            <ApiDesk />
          </div>
        </section>
      ) : null}
      {api ? null : <section className="thread">
        <header className="thread-top">
          <div className="thread-start">
            {sidebar ? null : (
              <button type="button" className="icon-btn" aria-label="Show history" onClick={toggleHistory}>
                <IconSidebar />
              </button>
            )}
            {sidebar ? null : (
              <button type="button" className="lockup-btn" onClick={() => go("/")}>
                <Lockup size={28} />
              </button>
            )}
            {active?.title ? <h1>{active.title}</h1> : null}
          </div>
          {active ? (
            <nav className="thread-nav" aria-label="Chat">
              <button type="button" className="icon-btn" aria-label="Copy transcript" onClick={() => navigator.clipboard.writeText(active.messages.map((message) => message.report ? reportPlainText(message.report) : `${message.role}: ${message.content}`).join("\n\n"))}>
                <IconCopy size={16} />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Download PDF"
                onClick={() => void downloadChatPdf(active)}
              >
                <IconExport size={16} />
              </button>
            </nav>
          ) : null}
        </header>
        <div className="thread-scroll" ref={scroller}>
          {!active || active.messages.length === 0 ? (
            <motion.div className="empty-chat" initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}>
              <motion.div variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
                <Lockup size={42} />
              </motion.div>
              <motion.h2 variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}>Which wallet are we looking at?</motion.h2>
              <motion.div className="suggest" variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}>
                <button type="button" onClick={() => void submit("Show the illustrative deployer read")}>Show a sample deployer</button>
                <button type="button" onClick={() => void submit("Read the Jupiter contract")}>Read the Jupiter contract</button>
                <button type="button" onClick={() => { setDraft("Trace where this wallet was funded: "); box.current?.focus(); }}>Trace where it was funded</button>
                <button type="button" onClick={() => { setDraft("Find risky approvals on "); box.current?.focus(); }}>Find risky approvals</button>
                <button type="button" onClick={() => { setDraft("Compare these two wallets:\n"); box.current?.focus(); }}>Compare two wallets</button>
              </motion.div>
            </motion.div>
          ) : (
            <div className="messages">
              <AnimatePresence initial={false}>
              {active.messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  busy={busy}
                  onFollow={(text) => void submit(text)}
                  onEdit={(next) => void submit(next, { threadId: active.id, userId: message.id })}
                  onRetry={() => {
                    const index = active.messages.findIndex((item) => item.id === message.id);
                    const user = [...active.messages.slice(0, index)].reverse().find((item) => item.role === "user");
                    if (user) void submit(user.content, { threadId: active.id, userId: user.id });
                  }}
                  onCopy={() => navigator.clipboard.writeText(message.report ? reportPlainText(message.report) : message.content)}
                  watching={Boolean(message.report?.watchAddress && watch.some((item) => item.address === message.report?.watchAddress))}
                  onPin={() => message.report && pin(message.report)}
                  onExpand={(visual) => setPanel({ kind: "visual", visual })}
                  onPick={(address) => void submit(`Read ${address}`)}
                  onRestore={(earlier) => {
                    setThreads((current) =>
                      current.map((thread) => {
                        if (thread.id !== active.id) return thread;
                        const index = thread.messages.findIndex((item) => item.id === message.id);
                        const restored = [
                          ...thread.messages.slice(0, index),
                          { ...message, content: earlier.content, earlier: message.earlier?.filter((item) => item !== earlier) },
                          ...earlier.after,
                        ];
                        return { ...thread, messages: restored };
                      }),
                    );
                  }}
                />
              ))}
              </AnimatePresence>
            </div>
          )}
        </div>
        <div className="thread-bottom">
        <motion.form
          className="composer-wrap"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit(draft);
          }}
        >
          <div className="composer">
            {chips.length ? (
              <div className="chips">
                {chips.map((address) => (
                  <span key={address} className="chip num">
                    {shortAddress(address)}
                  </span>
                ))}
              </div>
            ) : null}
            <textarea
              ref={box}
              rows={1}
              value={draft}
              placeholder="Ask about a Solana wallet, mint, or contract"
              aria-label="Message"
              onChange={(event) => {
                setDraft(event.target.value);
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit(draft);
                }
              }}
            />
            <div className="composer-bar">
              <button type="button" className="icon-btn" aria-label="Attach" disabled={busy} onClick={() => fileRef.current?.click()}>
                <IconAttach size={18} />
              </button>
              <input
                ref={fileRef}
                type="file"
                hidden
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file || busy) return;
                  void attachFile(file);
                }}
              />
              <div className="mode" role="group" aria-label="Scan mode">
                <button type="button" aria-pressed={mode === "quick"} onClick={() => setMode("quick")}>
                  Quick read
                </button>
                <button type="button" aria-pressed={mode === "deep"} onClick={() => setMode("deep")}>
                  Deep scan
                </button>
              </div>
              {busy ? (
                <button type="button" className="send" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
                  <IconStop size={18} />
                </button>
              ) : (
                <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()}>
                  <IconSend size={18} />
                </button>
              )}
            </div>
            <p className="mode-note">
              {mode === "deep"
                ? "Deep scan walks toward one year of signatures, samples interactions across that window, and reads the oldest funding address."
                : "Quick read walks toward six months of signatures and samples interactions across that window."}
            </p>
          </div>
        </motion.form>
        </div>
      </section>}
      <AnimatePresence>
      {panel ? (
        <motion.aside className="panel" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 28 }}>
          <header className="panel-head">
            <h2>{panel.kind === "visual" ? visualTitle(panel.visual) : "Evidence"}</h2>
            <button type="button" className="icon-btn" aria-label="Close panel" onClick={() => setPanel(null)}>
              <IconClose />
            </button>
          </header>
          {panel.kind === "visual" ? (
            <>
              <p className="quiet">{panel.visual.caption}</p>
              <VisualView visual={panel.visual} large onPick={(address) => void submit(`Read ${address}`)} />
            </>
          ) : (
            <EvidenceList finding={panel.finding} />
          )}
        </motion.aside>
      ) : null}
      </AnimatePresence>
    </div>
  );
}

function Message({
  message,
  busy,
  onFollow,
  onEdit,
  onRetry,
  onCopy,
  watching,
  onPin,
  onExpand,
  onPick,
  onRestore,
}: {
  message: ThreadMessage;
  busy: boolean;
  onFollow: (text: string) => void;
  onEdit: (text: string) => void;
  onRetry: () => void;
  onCopy: () => void;
  watching: boolean;
  onPin: () => void;
  onExpand: (visual: Visual) => void;
  onPick: (address: string) => void;
  onRestore: (earlier: { content: string; after: ThreadMessage[] }) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(message.content);
  const editBox = useRef<HTMLTextAreaElement>(null);
  function grow(node: HTMLTextAreaElement | null) {
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
  }
  useEffect(() => {
    if (!editing) return;
    grow(editBox.current);
    editBox.current?.focus();
    const length = editBox.current?.value.length ?? 0;
    editBox.current?.setSelectionRange(length, length);
  }, [editing]);
  if (message.role === "user") {
    return (
      <motion.div className={editing ? "msg user editing" : "msg user"} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} layout>
        {editing ? (
          <form
            className="edit-query"
            onSubmit={(event) => {
              event.preventDefault();
              const next = value.trim();
              if (!next) return;
              setEditing(false);
              onEdit(next);
            }}
          >
            <textarea
              ref={editBox}
              rows={1}
              value={value}
              aria-label="Edit question"
              onChange={(event) => {
                setValue(event.target.value);
                grow(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setValue(message.content);
                  setEditing(false);
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="edit-actions">
              <button
                type="button"
                className="text-btn"
                onClick={() => {
                  setValue(message.content);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn ink" disabled={busy || !value.trim()}>
                Send
              </button>
            </div>
          </form>
        ) : (
          <>
            <p>{message.content}</p>
            <div className="msg-actions">
              <button
                type="button"
                onClick={() => {
                  setValue(message.content);
                  setEditing(true);
                }}
                disabled={busy}
              >
                <IconEdit size={14} /> Edit
              </button>
              {message.earlier?.map((earlier, index) => (
                <button type="button" key={index} onClick={() => onRestore(earlier)}>
                  Earlier version {index + 1}
                </button>
              ))}
            </div>
          </>
        )}
      </motion.div>
    );
  }
  return (
    <motion.div className="msg assistant" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
      {message.steps && message.steps.length ? (
        <ol className="trail">
          {message.steps.map((step) => (
            <li key={step.label} className={step.state}>
              {step.state === "done" ? <span className="dot" /> : <span className="spin" />}
              {step.label}
            </li>
          ))}
        </ol>
      ) : null}
      {message.report ? (
        <ReportView report={message.report} onExpand={onExpand} onPick={onPick} />
      ) : message.content ? (
        <p>{message.content}</p>
      ) : null}
      {message.followups?.length ? (
        <div className="suggest">
          {message.followups.map((item) => (
            <button type="button" key={item} onClick={() => onFollow(item)} disabled={busy}>
              {item}
            </button>
          ))}
        </div>
      ) : null}
      {message.content || message.report ? (
        <div className="msg-actions">
          <button type="button" onClick={onRetry} disabled={busy}>Retry</button>
          <button type="button" onClick={onCopy}>
            <IconCopy size={14} /> Copy
          </button>
          {message.report?.watchAddress ? (
            <button type="button" className={watching ? "watching" : ""} aria-pressed={watching} onClick={onPin}>
              <IconPin size={14} /> {watching ? "Watching" : "Watch"}
            </button>
          ) : null}
          {message.stopped ? <span className="quiet">Stopped</span> : null}
        </div>
      ) : null}
    </motion.div>
  );
}

function ProfileName({
  name,
  detail,
  editing,
  draft,
  onDraft,
  onStart,
  onCancel,
  onSave,
  onSignOut,
}: {
  name: string;
  detail: string;
  editing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onSave: (value: string) => void;
  onSignOut?: () => void;
}) {
  const skipBlur = useRef(false);
  function commit() {
    onSave(cleanUsername(draft));
  }
  return (
    <div className="profile">
      <span className="profile-mark" aria-hidden="true">{initials(name)}</span>
      <div className="profile-copy">
        <div className="profile-line">
          {editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                commit();
              }}
            >
              <input
                value={draft}
                onChange={(event) => onDraft(event.target.value)}
                onBlur={() => {
                  if (skipBlur.current) {
                    skipBlur.current = false;
                    return;
                  }
                  commit();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    skipBlur.current = true;
                    onCancel();
                  }
                }}
                aria-label="Username"
                maxLength={32}
                autoFocus
              />
            </form>
          ) : (
            <button type="button" className="profile-edit" onClick={onStart} aria-label={`Edit username, ${name}`}>
              <span>{name}</span>
              <IconEdit size={14} />
            </button>
          )}
          {onSignOut ? (
            <button type="button" className="profile-signout" onClick={onSignOut} aria-label="Sign out">
              <IconSignOut size={16} />
            </button>
          ) : null}
        </div>
        <p className="quiet profile-meta">{detail}</p>
      </div>
    </div>
  );
}

function groupThreads(threads: Thread[]) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const groups: Record<string, Thread[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };
  for (const thread of [...threads].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (thread.pinned) groups.Pinned.push(thread);
    else if (thread.updatedAt >= today) groups.Today.push(thread);
    else if (thread.updatedAt >= today - 86400000) groups.Yesterday.push(thread);
    else if (thread.updatedAt >= today - 7 * 86400000) groups["Previous 7 days"].push(thread);
    else groups.Older.push(thread);
  }
  return groups;
}

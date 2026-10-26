import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EXAMPLE_MINT, EXAMPLE_PROGRAM, RULE_CATALOG, SCORING_VERSION } from "../engine/labels";
import { investigate } from "../engine/analyze";
import { shortAddress } from "../format";
import { Card, CardGrid, Line, Reveal } from "../motion";
import { Lockup } from "./mark";
import { IconAgent, IconArrow, IconBook, IconBuilding, IconChat, IconCite, IconClose, IconLock, IconMenu, IconPackage, IconPeople, IconPlus, IconSearch, IconToken } from "./icons";
import { MiniRead } from "./report";
import type { Report } from "../types";

const explorerRows = [
  "5jF2…a91k  System program  2.40 SOL",
  "3kLm…qq02  Token program  0.00 SOL",
  "8pQe…11aa  Jupiter  14,200 USDC",
  "2mNc…90ab  Unknown  0.02 SOL",
  "9kTd…441c  Raydium  add liquidity",
  "4pLs…88de  Compute budget  0.00012 SOL",
  "6hWe…10ff  Unknown  880,000 tokens",
  "1cVb…77aa  System program  18.0 SOL",
];

const readRows = [
  "Funded by a flagged wallet, 4 hops back",
  "Launched 6 tokens in 30 days, 5 lost liquidity",
  "Open delegate can move a token account",
  "40 transfers in one hour, script-like timing",
  "No mixer exposure in the scanned window",
  "Same fee payer as two deployer wallets",
  "Freeze authority still set on the mint",
  "Quiet for 140 days, then one large exit",
];

export function Chrome({
  path,
  go,
  children,
}: {
  path: string;
  go: (to: string) => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const item = (href: string, label: string) => (
    <a
      href={href}
      aria-current={path === href ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        setOpen(false);
        go(href);
      }}
    >
      {label}
    </a>
  );
  return (
    <div className="site">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header className="site-header">
        <motion.div className="announce" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <div className="frame">
            <button type="button" onClick={() => go("/method")}>
              Scoring method {SCORING_VERSION} is public. See how a wallet gets its number.
            </button>
          </div>
        </motion.div>
        <motion.div className="nav frame" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
          <button type="button" className="lockup-btn" onClick={() => go("/")}>
            <Lockup />
          </button>
          <nav className={open ? "open" : ""}>
            {item("/#features", "Features")}
            {item("/#engine", "Risk engine")}
            {item("/#developers", "Developers")}
            {item("/docs", "Docs")}
          </nav>
          <div className="nav-actions">
            <button type="button" className="btn ghost" onClick={() => go("/docs")}>
              Read the docs
            </button>
            <button type="button" className="btn ink" onClick={() => go("/app")}>
              Open app
            </button>
            <button type="button" className="icon-btn menu-btn" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((value) => !value)}>
              {open ? <IconClose /> : <IconMenu />}
            </button>
          </div>
        </motion.div>
      </header>
      <main id="content">{children}</main>
      <footer className="site-footer" id="site-footer">
        <div className="footer-panel">
          <div className="frame footer-top">
            <div className="footer-brand">
              <Lockup />
              <p className="footer-tag">Know the wallet before you trust it.</p>
            </div>
            <div className="footer-links">
              <div className="footer-col">
                <p className="eyebrow">Product</p>
                <button type="button" onClick={() => go("/#features")}>Features</button>
                <button type="button" onClick={() => go("/app")}>App</button>
                <button type="button" onClick={() => go("/#flow")}>How a read runs</button>
                <button type="button" onClick={() => go("/method")}>Method</button>
              </div>
              <div className="footer-col">
                <p className="eyebrow">Developers</p>
                <button type="button" onClick={() => go("/docs")}>Docs</button>
                <button type="button" onClick={() => go("/#developers")}>API shape</button>
              </div>
              <div className="footer-col">
                <p className="eyebrow">Notes</p>
                <button type="button" onClick={() => go("/docs#disclaimer")}>Disclaimer</button>
                <button type="button" onClick={() => go("/docs#privacy")}>Privacy</button>
              </div>
            </div>
          </div>
          <div className="frame footer-meta">
            <p>
              A score is a probabilistic read of public chain data. It is not an accusation, and it is not financial, legal, or tax advice. $KTRUST is a proposed utility for limits and label voting. It is not required to read a wallet.
            </p>
            <nav aria-label="Legal">
              <button type="button" onClick={() => go("/docs#disclaimer")}>Disclaimer</button>
              <button type="button" onClick={() => go("/docs#privacy")}>Privacy</button>
            </nav>
          </div>
          <div className="footer-plate">
            <img src="/crowd.jpg" alt="People standing together, seen from behind, in a bright field" />
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Home({ go }: { go: (to: string) => void }) {
  return (
    <>
      <section className="hero wrap">
        <h1>
          <Line index={0}>Know the Wallet.</Line>
          <Line index={1}>Measure the Risk.</Line>
          <Line index={2}>Protect Your Assets.</Line>
        </h1>
        <div className="hero-copy">
          <motion.p className="lede" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.48, duration: 0.7 }}>
            A wallet tracker for Solana that reads the chain for you and shows the evidence behind every answer.
          </motion.p>
          <motion.div className="hero-actions" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.7 }}>
            <button type="button" className="btn ink" onClick={() => go("/app")}>
              Open app
            </button>
            <button type="button" className="btn ghost" onClick={() => go("/docs")}>
              Read the docs
            </button>
          </motion.div>
          <motion.button type="button" className="scroll-cue" onClick={() => go("/#features")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
            Scroll to explore <IconArrow size={16} />
          </motion.button>
        </div>
        <div className="field hero-film">
          <video
            src="/hero.mp4"
            width={1280}
            height={720}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            aria-label="A robot working in a room"
          />
        </div>
      </section>

      <section className="section wrap" id="features">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Product</p>
            <h2>What KaziTrust is</h2>
          </header>
        </Reveal>
        <CardGrid className="cards three">
          <Card>
            <span className="card-icon"><IconChat size={18} /></span>
            <p className="eyebrow">The app</p>
            <h3>Chat with any wallet</h3>
            <p>Ask in plain language. The answer comes back as a score, the reasons, and the transactions behind them.</p>
            <button type="button" className="text-btn" onClick={() => go("/app")}>
              Open it today <IconArrow size={14} />
            </button>
          </Card>
          <Card>
            <span className="card-icon"><IconBook size={18} /></span>
            <p className="eyebrow">The engine</p>
            <h3>A method you can read</h3>
            <p>Funding, counterparties, behaviour, permissions, and the public blocked list. Version {SCORING_VERSION} lists every rule that fired.</p>
            <button type="button" className="text-btn" onClick={() => go("/method")}>
              Read the method <IconArrow size={14} />
            </button>
          </Card>
          <Card>
            <span className="card-icon"><IconPackage size={18} /></span>
            <p className="eyebrow">The API</p>
            <h3>The same read, in your product</h3>
            <p>Exchanges, launchpads, and agents can ask for the same report. The package shape is published. The hosted API is next.</p>
            <button type="button" className="text-btn" onClick={() => go("/#developers")}>
              See the shape <IconArrow size={14} />
            </button>
          </Card>
        </CardGrid>
      </section>

      <section className="wrap tool-strip" aria-label="What a read uses">
        <p className="eyebrow">A read uses</p>
        <ul>
          <li>Solana mainnet</li>
          <li>FluxRPC, then a public node</li>
          <li>RugCheck, for the token risk report on a mint</li>
          <li>Solscan, for the label, portfolio, and recent DeFi activity</li>
          <li>The OFAC SDN list, for blocked Solana addresses</li>
          <li>Method {SCORING_VERSION}</li>
        </ul>
      </section>

      <section className="section wrap" id="problem">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">The difference</p>
            <h2>On Solana, every wallet is an open book. Almost nobody can read it.</h2>
            <p className="lede">An explorer shows the rows. KaziTrust says what the rows mean, and it keeps the signature next to the sentence. The lines below are samples of that difference.</p>
          </header>
        </Reveal>
        <div className="feeds">
          <Feed title="What an explorer shows" rows={explorerRows} />
          <Feed title="What KaziTrust tells you" rows={readRows} />
        </div>
      </section>

      <LiveTry go={go} />

      <section className="section wrap" id="engine">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Risk engine</p>
            <h2>Three questions, answered</h2>
          </header>
        </Reveal>
        <Questions />
      </section>

      <section className="section wrap" id="audiences">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Audiences</p>
            <h2>Who it is for</h2>
          </header>
        </Reveal>
        <CardGrid className="cards six">
          {[
            { title: "Traders", body: "Decide whether a deployer or a token is worth the click.", icon: <IconSearch size={18} /> },
            { title: "Communities and DAOs", body: "Vet a wallet before an allowlist, a grant, or a payout.", icon: <IconPeople size={18} /> },
            { title: "Researchers", body: "Trace funds and see the accounts that move together.", icon: <IconBook size={18} /> },
            { title: "Token teams", body: "Check a mint's authorities before you tell holders it is safe.", icon: <IconToken size={18} /> },
            { title: "Platforms and exchanges", body: "Score an address at sign-up, with the evidence attached.", icon: <IconBuilding size={18} /> },
            { title: "Agents", body: "Ask for a counterparty check before a payment goes out.", icon: <IconAgent size={18} /> },
          ].map((item) => (
            <Card key={item.title}>
              <span className="card-icon">{item.icon}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </Card>
          ))}
        </CardGrid>
      </section>

      <section className="section wrap" id="compare">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Arrangement of the work</p>
            <h2>A chat model can invent a hop. This read cannot.</h2>
          </header>
        </Reveal>
        <div className="contrast">
          <article>
            <p className="eyebrow">A general chat model</p>
            <h3>Writes from memory</h3>
            <ul>
              <li>Can name an address it never fetched.</li>
              <li>Can describe a funding path with no signature.</li>
              <li>The number has no published rule behind it.</li>
            </ul>
          </article>
          <article className="ours">
            <p className="eyebrow">KaziTrust</p>
            <h3>Writes from the tools</h3>
            <ul>
              <li>Balance, signatures, and token accounts come from a public node.</li>
              <li>A line that names an uncited address is dropped.</li>
              <li>Every point on the score names the rule that added it.</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="section wrap" id="flow">
        <div className="work">
          <Reveal>
            <header className="section-head">
              <p className="eyebrow">A read</p>
              <h2>Three steps, then the evidence</h2>
              <p className="lede">The chain tools run first. The language model only phrases what they returned.</p>
            </header>
            <ol className="steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Paste an address</strong>
                  <p>A wallet, a mint, or a program. A name is not enough.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>The tools run first</strong>
                  <p>Balance, recent signatures, token accounts, then a handful of opened transactions.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>The score cites them</strong>
                  <p>The sentences only restate what the tools returned. They do not change the number, the band, or the addresses.</p>
                </div>
              </li>
            </ol>
          </Reveal>
          <article className="device" aria-label="Sample read on a device screen">
            <div className="device-chassis">
              <div className="device-speaker" aria-hidden="true" />
              <div className="device-screen">
                <header className="device-head">
                  <div className="device-id">
                    <div>
                      <h3>Token deployer</h3>
                      <p className="quiet num">7xKp…q9Rd</p>
                    </div>
                    <div className="device-score">
                      <p className="score num">72</p>
                      <p>Elevated</p>
                    </div>
                  </div>
                </header>
                <ul>
                  <li><span>Sample base</span><span className="num">+22</span></li>
                  <li><span>Repeated launches that lost liquidity</span><span className="num">+28</span></li>
                  <li><span>Shared funding source</span><span className="num">+14</span></li>
                  <li><span>Freeze authority still held</span><span className="num">+8</span></li>
                </ul>
                <p className="quiet">These figures teach the shape of a read. They are not a live chain query.</p>
                <button type="button" className="btn ink wide" onClick={() => go("/app?q=Show%20the%20illustrative%20deployer%20read")}>
                  Open this sample in the app
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <section className="section wrap" id="evidence">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Evidence</p>
            <h2>Evidence, not opinion</h2>
            <p className="lede">Every finding in a live read opens onto the account read or the signatures that produced it. If the tools did not return an address, the line is dropped.</p>
          </header>
        </Reveal>
        <EvidenceDemo />
      </section>

      <section className="section wrap" id="developers">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Developers</p>
            <h2>Add a wallet read to anything</h2>
            <p className="lede">One call returns the same object the app renders: score, band, findings, and visuals. This package is not on npm yet. The shape is the contract.</p>
          </header>
          <pre className="code">{`import { readWallet } from "@kazitrust/sdk";

const report = await readWallet({
  address,
  mode: "quick",
});

report.riskScore
report.band
report.findings[0].evidence`}</pre>
          <div className="hero-actions">
            <button type="button" className="btn ghost" onClick={() => go("/docs")}>
              Read the docs
            </button>
            <button type="button" className="btn ghost" onClick={() => go("/method")}>
              Scoring method
            </button>
          </div>
        </Reveal>
      </section>

      <section className="section wrap" id="trust">
        <Reveal>
          <header className="section-head">
            <p className="eyebrow">Trust</p>
            <h2>No black boxes</h2>
          </header>
        </Reveal>
        <CardGrid className="cards three">
          <Card>
            <span className="card-icon"><IconBook size={18} /></span>
            <h3>The method is versioned</h3>
            <p>Version {SCORING_VERSION} lists its rules. A later version will not quietly replace them.</p>
          </Card>
          <Card>
            <span className="card-icon"><IconLock size={18} /></span>
            <h3>No custody, ever</h3>
            <p>Paste an address, or connect a wallet later for a read-only approvals check. KaziTrust never asks for a signature that moves assets.</p>
          </Card>
          <Card>
            <span className="card-icon"><IconCite size={18} /></span>
            <h3>The score cites its inputs</h3>
            <p>A live number is reproducible from the signatures and account reads named in the report.</p>
          </Card>
        </CardGrid>
      </section>
    </>
  );
}

function Feed({ title, rows }: { title: string; rows: string[] }) {
  const loop = [...rows, ...rows];
  return (
    <div className="feed">
      <p className="eyebrow">{title}</p>
      <div className="feed-window">
        <div className="feed-track">
          {loop.map((row, index) => (
            <p key={`${row}-${index}`}>{row}</p>
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveTry({ go }: { go: (to: string) => void }) {
  const [address, setAddress] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function run(value: string) {
    setLoading(true);
    setError("");
    setReport(null);
    try {
      const answer = await investigate({
        question: `Read ${value}`,
        mode: "quick",
        signal: AbortSignal.timeout(35000),
      });
      if (answer.kind === "report") setReport(answer.report);
      else setError(answer.text);
    } catch {
      setError("The read did not finish. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Reveal>
      <section className="section wrap" id="try">
      <header className="section-head">
        <p className="eyebrow">Live read</p>
        <h2>Try a live read</h2>
        <p className="lede">Paste a Solana address. The mini report uses the same engine as the app, against a public node.</p>
      </header>
      <form
        className="try-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (address.trim()) void run(address.trim());
        else setError("Paste an address, or try one of the examples.");
        }}
      >
        <label htmlFor="wallet">Wallet, mint, or program</label>
        <div className="try-row">
          <input
            id="wallet"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="Paste a Solana address"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="btn ink" disabled={loading}>
            {loading ? "Reading" : "Read wallet"}
          </button>
        </div>
      </form>
      <div className="try-examples">
        <button type="button" onClick={() => { setAddress(EXAMPLE_PROGRAM); void run(EXAMPLE_PROGRAM); }}>
          Jupiter program {shortAddress(EXAMPLE_PROGRAM)}
        </button>
        <button type="button" onClick={() => { setAddress(EXAMPLE_MINT); void run(EXAMPLE_MINT); }}>
          USDC mint {shortAddress(EXAMPLE_MINT)}
        </button>
      </div>
      {error ? <motion.p className="banner" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{error}</motion.p> : null}
      {loading ? <div className="skeleton" aria-hidden="true" /> : null}
      <AnimatePresence>
        {report ? (
          <motion.div className="try-result" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <MiniRead report={report} />
            <button type="button" className="btn ghost" onClick={() => go(`/app?address=${report.wallet}&t=${Date.now()}`)}>
              Open this read in the app
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      </section>
    </Reveal>
  );
}

function Questions() {
  const [active, setActive] = useState(0);
  const items = [
    {
      kicker: "Know the wallet",
      title: "Profile and history",
      body: "Type, balance, first visible transaction, and the hours it tends to move. The guess is labelled, and thin history stays thin.",
    },
    {
      kicker: "Measure the risk",
      title: "A number and the reasons",
      body: "Zero to one hundred. Higher is riskier. The band is a word and a four-part gauge, so the level is not carried by colour alone.",
    },
    {
      kicker: "Protect your assets",
      title: "Approvals, without a transaction",
      body: "Open delegates and freeze authorities are listed from the account data. KaziTrust stops at the list. It does not build a revoke.",
    },
  ];
  return (
    <div className="questions">
      <div className="question-tabs">
        {items.map((item, index) => (
          <button key={item.kicker} type="button" aria-pressed={active === index} onClick={() => setActive(index)}>
            <span className="eyebrow">{item.kicker}</span>
            <strong>{item.title}</strong>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.article
          key={items[active].kicker}
          className="question-panel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          <p className="eyebrow">{items[active].kicker}</p>
          <h3>{items[active].title}</h3>
          <p>{items[active].body}</p>
        </motion.article>
      </AnimatePresence>
    </div>
  );
}

function EvidenceDemo() {
  const [open, setOpen] = useState(false);
  return (
    <article className="evidence-demo">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span>Open delegate can move the USDC account.</span>
        <span className="evidence-mark" aria-hidden="true">{open ? <IconClose size={16} /> : <IconPlus size={16} />}</span>
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div className="evidence" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="evidence-head">
              <p>Instances</p>
              <span className="num">2</span>
            </div>
            <ol>
              <li>
                <span className="evidence-index num">1</span>
                <div className="evidence-body">
                  <div className="evidence-top">
                    <strong>Transaction</strong>
                    <span className="quiet num">4kQm…aa91</span>
                  </div>
                  <p className="quiet">Slot 210,441,002</p>
                </div>
              </li>
              <li>
                <span className="evidence-index num">2</span>
                <div className="evidence-body">
                  <div className="evidence-top">
                    <strong>Account read</strong>
                    <span className="quiet num">8pQe…11aa</span>
                  </div>
                  <p className="quiet">Token account</p>
                </div>
              </li>
            </ol>
            <p className="quiet">These two lines are illustrations. A live finding links to Solscan.</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}

export function Docs({ go }: { go: (to: string) => void }) {
  return (
    <DocFrame
      go={go}
      path="/docs"
      links={[
        ["comes-back", "What comes back"],
        ["limits", "What it will not do"],
        ["api", "The API shape"],
        ["privacy", "Privacy"],
        ["disclaimer", "Disclaimer"],
        ["rules", "The rules"],
      ]}
    >
      <header className="page-head">
        <p className="eyebrow">Docs</p>
        <h1>How to read a wallet</h1>
        <p className="lede">Paste an address, read the score, and open the evidence behind each line.</p>
      </header>
      <p>Paste any Solana address into the app. A quick read uses the latest signatures, the balance, the token accounts, and a handful of opened transactions. A deep scan widens that window. It still does not walk the entire chain.</p>
      <h2 id="comes-back">What comes back</h2>
      <p>A score from 0 to 100, a band, a confidence word, three to five findings, and the pictures that match the question. Each finding has an evidence control. Transaction evidence opens on Solscan. Account evidence names the slot of the read.</p>
      <h2 id="limits">What it will not do</h2>
      <p>It will not invent a hop, a label, or a dollar value. It will not name a person. It will not ask you to sign a transaction. Mixer exposure, sanction lists, and a full funding graph need the hosted index. Until that ships, the report says when a check was not run.</p>
      <h2 id="api">The API shape</h2>
      <p>The planned call is <span className="num">readWallet</span>, returning the same report object the app renders. The package is not published. Daily live reads in this browser build are capped at 30.</p>
      <h2 id="privacy">Privacy</h2>
      <p>Chats, the watchlist, and the daily counter stay in this browser. KaziTrust does not run an account system in this version. Chain queries go to a public Solana node and contain the address you asked about.</p>
      <h2 id="disclaimer">Disclaimer</h2>
      <p>Scores are indicators. They are a probabilistic read of public data under a published method. They are not a finding of fact about any person, and they are not financial, legal, or tax advice. Full terms will be drafted before a public launch. $KTRUST, if issued, is a utility for limits and label voting, not a promise of value.</p>
      <h2 id="rules">The rules, in short</h2>
      <ul>
        {RULE_CATALOG.map((rule) => (
          <li key={rule.title}>
            <strong>{rule.title}. </strong>
            {rule.detail}
          </li>
        ))}
      </ul>
      <PageFoot go={go} links={[["/app", "Open app"], ["/method", "Scoring method"], ["/", "Home"]]} />
    </DocFrame>
  );
}

export function Method({ go }: { go: (to: string) => void }) {
  return (
    <DocFrame
      go={go}
      path="/method"
      links={[
        ["tools", "Tools"],
        ["rules", "Rules"],
        ["bands", "Bands"],
        ["confidence", "Confidence"],
        ["not-scored", "Not scored yet"],
      ]}
    >
      <header className="page-head">
        <p className="eyebrow">Method {SCORING_VERSION}</p>
        <h1>How a wallet gets its number</h1>
        <p className="lede">The number only moves when a published rule fires on data the tools returned.</p>
      </header>
      <p>The investigator plans the question, calls chain tools, and writes only from what those tools return. An automated check removes any address that was not in the tool output. That is the difference from a general chat model, which can describe a funding path it never fetched.</p>
      <h2 id="tools">Tools</h2>
      <p>getBalance, getAccountInfo, getSignaturesForAddress, getTokenAccountsByOwner, and getTransaction. Quick mode asks for 25 signatures and opens 4 transactions. Deep mode asks for 80 and opens 10. Token accounts are skipped for programs and mints. A mint read also asks RugCheck for its published token report. That score is shown on its own and does not move the KaziTrust number.</p>
      <h2 id="rules">Rules in this version</h2>
      <ul>
        {RULE_CATALOG.map((rule) => (
          <li key={rule.title}>
            <strong>{rule.title}. </strong>
            {rule.detail}
          </li>
        ))}
      </ul>
      <h2 id="bands">Bands</h2>
      <p>0 to 24 is Low. 25 to 49 is Guarded. 50 to 74 is Elevated. 75 to 100 is High. The gauge fills one segment per step. High uses a hatched fill so the top band is visible without a new colour.</p>
      <h2 id="confidence">Confidence</h2>
      <p>Low means a short window or a failed token read. High means a long span, a full visible history or a wide window, and several opened transactions. A labelled program can also be high confidence, because the identity is the finding.</p>
      <h2 id="not-scored">What this version does not score</h2>
      <p>Distance to a mixer, sanctions matches, dollar prices, and clusters beyond the transactions that were opened. Those stay out of the number until the index can cite them. The label list is a short public set of programs and major mints, versioned with the method.</p>
      <PageFoot go={go} links={[["/app", "Open app"], ["/docs", "Docs"], ["/", "Home"]]} />
    </DocFrame>
  );
}

function DocFrame({
  go,
  path,
  links,
  children,
}: {
  go: (to: string) => void;
  path: string;
  links: [string, string][];
  children: ReactNode;
}) {
  return (
    <div className="doc-layout wrap">
      <nav className="doc-rail" aria-label="On this page">
        <p className="eyebrow">On this page</p>
        {links.map(([id, label]) => (
          <a
            key={id}
            href={`${path}#${id}`}
            onClick={(event) => {
              event.preventDefault();
              go(`${path}#${id}`);
            }}
          >
            {label}
          </a>
        ))}
      </nav>
      <motion.article className="prose" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}>
        {children}
      </motion.article>
    </div>
  );
}

function PageFoot({ go, links }: { go: (to: string) => void; links: [string, string][] }) {
  return (
    <footer className="page-foot">
      {links.map(([href, label]) => (
        <button key={href} type="button" onClick={() => go(href)}>
          {label}
        </button>
      ))}
    </footer>
  );
}

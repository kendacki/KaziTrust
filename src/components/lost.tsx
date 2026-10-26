import { IconArrow } from "./icons";
import { Lockup } from "./mark";

export function Lost({ go, mode }: { go: (to: string) => void; mode: "missing" | "offline" }) {
  const offline = mode === "offline";
  return (
    <section className="lost">
      <header className="lost-bar frame">
        <button type="button" className="lockup-btn" onClick={() => go("/")}>
          <Lockup />
        </button>
        {offline ? (
          <span className="lost-state">Offline</span>
        ) : (
          <button type="button" className="btn ink" onClick={() => go("/app")}>
            Open app
          </button>
        )}
      </header>
      <div className="lost-stage">
        <div className="lost-visual">
          <p className="lost-num" aria-hidden="true">
            404
          </p>
          <img className="lost-figure" src="/lost.png" alt="" />
        </div>
        <div className="lost-copy">
          <h1>{offline ? "The connection dropped." : "This page is not here."}</h1>
          <p>{offline ? "This screen stays until the network returns." : "Head back somewhere familiar."}</p>
          <button type="button" className="lost-home" onClick={() => go("/")}>
            <span className="lost-back" aria-hidden="true">
              <IconArrow size={14} />
            </span>
            Back to home
          </button>
        </div>
      </div>
    </section>
  );
}

import { useEffect, type ReactNode } from "react";
import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import { Lockup } from "./components/mark";

const appId = import.meta.env.VITE_PRIVY_APP_ID ?? "";
let prompted = false;

export function AuthRoot({ children }: { children: ReactNode }) {
  if (!appId) return children;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google"],
        appearance: { theme: "light", accentColor: "#0b0c0e", showWalletLoginFirst: false },
        embeddedWallets: {
          ethereum: { createOnLogin: "off" },
          solana: { createOnLogin: "off" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

function GateScreen({
  go,
  title,
  lede,
  note,
  action,
}: {
  go: (to: string) => void;
  title?: string;
  lede: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <section className="gate">
      <header className="site-header">
        <div className="nav frame">
          <button type="button" className="lockup-btn" onClick={() => go("/")}>
            <Lockup />
          </button>
        </div>
      </header>
      <div className="gate-main frame">
        <div className="gate-copy">
          {title ? <h1>{title}</h1> : null}
          <p className="lede">{lede}</p>
          {note ? <p className="quiet">{note}</p> : null}
          {action}
        </div>
      </div>
      <div className="gate-plate">
        <img src="/crowd.jpg" alt="People standing together, seen from behind, in a bright field" />
      </div>
    </section>
  );
}

export function RequireAuth({ go, children }: { go: (to: string) => void; children: ReactNode }) {
  if (import.meta.env.DEV) return children;
  if (!appId) {
    return <GateScreen go={go} title="Sign-in is not configured." lede="Add the Privy app id on the server, then open the app again." />;
  }
  return <AuthGate go={go}>{children}</AuthGate>;
}

function AuthGate({ go, children }: { go: (to: string) => void; children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { login } = useLogin();

  useEffect(() => {
    if (!ready || authenticated || prompted) return;
    prompted = true;
    login();
  }, [ready, authenticated, login]);

  if (!ready) {
    return <GateScreen go={go} lede="Checking your session." />;
  }

  if (!authenticated) {
    return (
      <GateScreen
        go={go}
        title="Sign in to read a wallet."
        lede="Create an account or sign in before a Wallet assessment."
        action={
          <button type="button" className="btn ink" onClick={() => login()}>
            Sign in
          </button>
        }
      />
    );
  }

  return children;
}

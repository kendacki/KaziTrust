import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { trackPage } from "./analytics";
import { ConsentRoot } from "./components/consent";
import { Lost } from "./components/lost";
import { PrivacyChoicesPage, PrivacyPage } from "./components/privacy";
import { Chrome, Docs, Home, Method } from "./components/site";
import { ease } from "./motion";

const AuthRoot = lazy(() => import("./auth").then((mod) => ({ default: mod.AuthRoot })));
const RequireAuth = lazy(() => import("./auth").then((mod) => ({ default: mod.RequireAuth })));
const Chat = lazy(() => import("./components/chat").then((mod) => ({ default: mod.Chat })));
const ApiEntry = lazy(() => import("./components/api").then((mod) => ({ default: mod.ApiEntry })));

const KNOWN = new Set(["/", "/app", "/app/api", "/app/wallet", "/docs", "/method", "/api", "/privacy", "/privacy/choices"]);

function needsPrivy(path: string) {
  return path.startsWith("/app") || path === "/api";
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function RouteFallback({ app }: { app?: boolean }) {
  return <div className={app ? "page-app" : "page-fade"} aria-busy="true" />;
}

export function App() {
  const [url, setUrl] = useState(() => window.location.pathname + window.location.search + window.location.hash);

  useEffect(() => {
    const onPop = () => setUrl(window.location.pathname + window.location.search + window.location.hash);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((to: string) => {
    const hash = to.includes("#") ? to.split("#")[1] : "";
    window.history.pushState({}, "", to);
    setUrl(window.location.pathname + window.location.search + window.location.hash);
    if (!hash) window.scrollTo(0, 0);
  }, []);

  const bare = url.split("?")[0].split("#")[0] || "/";
  const path = bare.length > 1 ? bare.replace(/\/+$/, "") : bare;
  const hash = url.includes("#") ? url.split("#")[1] : "";
  const online = useOnline();
  const missing = !KNOWN.has(path);
  const [privyMounted, setPrivyMounted] = useState(() => needsPrivy(path));

  useEffect(() => {
    if (needsPrivy(path)) setPrivyMounted(true);
  }, [path]);

  useEffect(() => {
    document.title = !online
      ? "Offline · KaziTrust"
      : missing
        ? "Page not found · KaziTrust"
        : path === "/app"
          ? "App · KaziTrust"
          : path === "/app/wallet"
            ? "Wallet · KaziTrust"
            : path === "/docs"
              ? "Docs · KaziTrust"
              : path === "/method"
                ? "Method · KaziTrust"
                : path === "/api" || path === "/app/api"
                  ? "API · KaziTrust"
                  : path === "/privacy/choices"
                    ? "Do Not Sell or Share · KaziTrust"
                    : path === "/privacy"
                      ? "Privacy · KaziTrust"
                      : "KaziTrust AI";
  }, [path, online, missing]);

  useEffect(() => {
    trackPage(!online ? "offline" : missing ? "missing" : path);
  }, [path, online, missing]);

  // Hash targets often mount after route animation; retry until the section exists.
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    let tries = 0;
    const jump = () => {
      if (cancelled) return;
      const target = document.getElementById(hash);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      tries += 1;
      if (tries < 30) window.setTimeout(jump, 40);
    };
    const start = window.setTimeout(jump, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, [path, hash]);

  let body: ReactNode;
  if (!online) body = <Lost go={go} mode="offline" />;
  else if (missing) body = <Lost go={go} mode="missing" />;
  else if (path === "/app" || path === "/app/api" || path === "/app/wallet") {
    body = (
      <Suspense fallback={<RouteFallback app />}>
        <RequireAuth go={go}>
          <Chat go={go} api={path === "/app/api"} wallet={path === "/app/wallet"} />
        </RequireAuth>
      </Suspense>
    );
  } else if (path === "/docs") body = <Chrome path={path} go={go}><Docs go={go} /></Chrome>;
  else if (path === "/method") body = <Chrome path={path} go={go}><Method go={go} /></Chrome>;
  else if (path === "/privacy/choices") body = <PrivacyChoicesPage go={go} />;
  else if (path === "/privacy") body = <PrivacyPage go={go} />;
  else if (path === "/api") {
    body = (
      <Suspense fallback={<RouteFallback />}>
        <ApiEntry go={go} />
      </Suspense>
    );
  } else body = <Chrome path={path} go={go}><Home go={go} /></Chrome>;

  const shell = (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.55, ease }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={!online ? "offline" : path}
          className={!online || missing ? "page-fade lost-page" : path.startsWith("/app") ? "page-app" : "page-fade"}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
      <ConsentRoot go={go} />
    </MotionConfig>
  );

  if (!privyMounted) return shell;

  return (
    <Suspense
      fallback={
        <MotionConfig reducedMotion="user" transition={{ duration: 0.55, ease }}>
          <RouteFallback app={path.startsWith("/app")} />
          <ConsentRoot go={go} />
        </MotionConfig>
      }
    >
      <AuthRoot>{shell}</AuthRoot>
    </Suspense>
  );
}

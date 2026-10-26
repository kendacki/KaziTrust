import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { RequireAuth } from "./auth";
import { Chat } from "./components/chat";
import { Lost } from "./components/lost";
import { Chrome, Docs, Home, Method } from "./components/site";
import { ApiEntry } from "./components/api";
import { ease } from "./motion";

const KNOWN = new Set(["/", "/app", "/app/api", "/docs", "/method", "/api"]);

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
    if (hash) {
      window.setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" }), 40);
    } else {
      window.scrollTo(0, 0);
    }
  }, []);

  const path = url.split("?")[0].split("#")[0] || "/";
  const online = useOnline();
  const missing = !KNOWN.has(path);
  useEffect(() => {
    document.title = !online ? "Offline · KaziTrust" : missing ? "Page not found · KaziTrust" : path === "/app" ? "App · KaziTrust" : path === "/docs" ? "Docs · KaziTrust" : path === "/method" ? "Method · KaziTrust" : path === "/api" || path === "/app/api" ? "API · KaziTrust" : "KaziTrust AI";
  }, [path, online, missing]);

  let body;
  if (!online) body = <Lost go={go} mode="offline" />;
  else if (missing) body = <Lost go={go} mode="missing" />;
  else if (path === "/app" || path === "/app/api") body = <RequireAuth go={go}><Chat go={go} api={path === "/app/api"} /></RequireAuth>;
  else if (path === "/docs") body = <Chrome path={path} go={go}><Docs go={go} /></Chrome>;
  else if (path === "/method") body = <Chrome path={path} go={go}><Method go={go} /></Chrome>;
  else if (path === "/api") body = <ApiEntry go={go} />;
  else body = <Chrome path={path} go={go}><Home go={go} /></Chrome>;

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.55, ease }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={!online ? "offline" : path}
          className={!online || missing ? "page-fade lost-page" : path === "/app" || path === "/app/api" ? "page-app" : "page-fade"}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
        >
          {body}
        </motion.div>
      </AnimatePresence>
    </MotionConfig>
  );
}

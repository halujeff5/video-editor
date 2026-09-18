import { useEffect, useState } from "react";
import App from "./App.jsx";
import AuthLandingPage from "./components/AuthLandingPage.jsx";

function RootRouter() {
  const [path, setPath] = useState(window.location.pathname);
  const [sessionState, setSessionState] = useState("checking");

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then((response) => {
        if (cancelled) return;
        if (!response.ok && window.location.pathname === "/project") {
          window.history.replaceState({}, "", "/");
          setPath("/");
        }
        setSessionState(response.ok ? "authenticated" : "anonymous");
      })
      .catch(() => {
        if (!cancelled) setSessionState("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  function navigate(nextPath) {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  }

  if (sessionState === "checking") return <div className="route-loading">Loading...</div>;
  if (path === "/project" && sessionState === "authenticated") return <App />;
  return <AuthLandingPage onEnterProject={() => {
    setSessionState("authenticated");
    navigate("/project");
  }} />;
}

export default RootRouter;

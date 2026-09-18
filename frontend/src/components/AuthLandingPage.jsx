import { useState } from "react";
import "./AuthLandingPage.css";

function AuthLandingPage({ onEnterProject }) {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("passwordConfirmation") || "");

    if (!email || password.length < 8) {
      setError("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    if (mode === "signup" && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to authenticate");
      onEnterProject(payload.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  function selectMode(nextMode) {
    setMode(nextMode);
    setError("");
  }

  return (
    <main className="auth-page">
      <section className="auth-brand" aria-labelledby="auth-brand-title">
        <span className="auth-mark" aria-hidden="true">TS</span>
        <div>
          <h1 id="auth-brand-title">Timeline Studio 🎬</h1>
          <p>Build the cut, shape the sound, and keep every second in view.</p>
        </div>
        <div className="auth-timeline" aria-hidden="true">
          <span />
          <span />
          <span />
          <i />
        </div>
      </section>

      <section className="auth-form-panel" aria-labelledby="auth-form-title">
        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "login"}
            className={mode === "login" ? "active" : ""}
            onClick={() => selectMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "signup"}
            className={mode === "signup" ? "active" : ""}
            onClick={() => selectMode("signup")}
          >
            Sign up
          </button>
        </div>

        <h2 id="auth-form-title">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            <span>Email</span>
            <input name="email" type="email" autoComplete="email" placeholder=" " required />
          </label>
          <label>
            <span>Password</span>
            <input
              name="password"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              placeholder=" "
              minLength="8"
              required
            />
          </label>
          {mode === "signup" && (
            <label>
              <span>Confirm password</span>
              <input
                name="passwordConfirmation"
                type="password"
                autoComplete="new-password"
                placeholder=" "
                minLength="8"
                required
              />
            </label>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting
              ? "Please wait..."
              : mode === "login" ? "Open studio" : "Create account"}
          </button>
        </form>
        <a
          className="auth-patreon-link"
          href="https://patreon.com/JeffreyNg?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink"
          target="_blank"
          rel="noreferrer"
        >
          Support on Patreon
        </a>
      </section>
    </main>
  );
}

export default AuthLandingPage;

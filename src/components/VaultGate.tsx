import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { AutoTraceLogo } from "./AutoTraceLogo";

type GateState = "checking" | "locked" | "open";

/** Blocks the app behind a passphrase prompt while the database is encrypted at rest. */
export function VaultGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<GateState>("checking");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .vaultStatus()
      .then((s) => setGate(s.locked ? "locked" : "open"))
      // Older backends / browser-only dev mode: never block the UI on this check.
      .catch(() => setGate("open"));
  }, []);

  if (gate === "open") return <>{children}</>;
  if (gate === "checking") return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pass || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlockDatabase(pass);
      setPass("");
      setGate("open");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="vault-gate">
      <form className="card vault-card" onSubmit={submit} aria-labelledby="vault-title">
        <AutoTraceLogo size={40} />
        <h1 id="vault-title">Your data is locked</h1>
        <p className="muted">
          AutoTrace encrypted your database at rest. Enter your passphrase to unlock it and resume
          tracking.
        </p>
        <label className="vault-field">
          <span>Passphrase</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "vault-error" : undefined}
          />
        </label>
        {error && (
          <p id="vault-error" className="vault-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn" disabled={!pass || busy}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}

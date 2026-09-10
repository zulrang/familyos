"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import styles from "@/shared/Admin.module.css";
import { adminRequest } from "@/shared/admin-client";

type Session = { status: "locked" } | { status: "unlocked"; expiresAt: number };
type Gate =
  | Session
  | { status: "checking" }
  | { status: "error"; error: string };

export function AdminShell({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ status: "checking" });
  const [suspended, setSuspended] = useState(false);
  const [pin, setPin] = useState("");
  const [login, setLogin] = useState<{
    status: "idle" | "saving";
    error?: string;
  }>({ status: "idle" });
  const lastActivity = useRef(0);
  const lastSentActivity = useRef(0);
  const pathname = usePathname();

  const checkSession = useCallback(async () => {
    try {
      if (sessionStorage.getItem("admin-locked") === "yes") {
        await adminRequest("session", undefined, "DELETE");
        setGate({ status: "locked" });
      } else {
        const current = await adminRequest<Session>("session");
        setGate(current);
      }
    } catch (error) {
      setGate({ status: "error", error: (error as Error).message });
    } finally {
      setSuspended(false);
    }
  }, []);

  const lock = useCallback(async () => {
    sessionStorage.setItem("admin-locked", "yes");
    setGate({ status: "locked" });
    setPin("");
    try {
      await adminRequest("session", undefined, "DELETE");
    } catch {
      /* The local lock remains set; reconnecting retries server revocation. */
    }
  }, []);

  useEffect(() => {
    void checkSession();
    const expired = () => {
      void lock();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void checkSession();
      else setSuspended(true);
    };
    window.addEventListener("admin-session-expired", expired);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("admin-session-expired", expired);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [checkSession, lock]);

  useEffect(() => {
    if (gate.status !== "unlocked") return;
    let sending = false;
    const sendActivity = async () => {
      if (Date.now() >= gate.expiresAt) {
        void lock();
        return;
      }
      if (
        sending ||
        lastActivity.current <= lastSentActivity.current ||
        document.visibilityState !== "visible"
      )
        return;
      sending = true;
      const sent = lastActivity.current;
      try {
        const next = await adminRequest<Session>("session", { activity: true });
        lastSentActivity.current = sent;
        setGate((current) => (current.status === "unlocked" ? next : current));
      } catch {
        /* Keep the last server expiry; offline use never extends a session. */
      } finally {
        sending = false;
      }
    };
    const activity = () => {
      lastActivity.current = Date.now();
      if (lastActivity.current - lastSentActivity.current >= 10_000)
        void sendActivity();
    };
    const timer = setInterval(() => {
      void sendActivity();
    }, 10_000);
    const expiry = setTimeout(
      () => {
        void lock();
      },
      Math.max(0, gate.expiresAt - Date.now()),
    );
    for (const event of ["pointerdown", "keydown", "input", "scroll"])
      window.addEventListener(event, activity, true);
    return () => {
      clearInterval(timer);
      clearTimeout(expiry);
      for (const event of ["pointerdown", "keydown", "input", "scroll"])
        window.removeEventListener(event, activity, true);
    };
  }, [gate, lock]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLogin({ status: "saving" });
    try {
      const next = await adminRequest<Session>("session", { pin });
      sessionStorage.removeItem("admin-locked");
      lastActivity.current = Date.now();
      lastSentActivity.current = lastActivity.current;
      setGate(next);
      setPin("");
      setLogin({ status: "idle" });
    } catch (error) {
      setPin("");
      setLogin({ status: "idle", error: (error as Error).message });
    }
  }

  return (
    <div
      className={styles.app}
      style={suspended ? { visibility: "hidden" } : undefined}
    >
      <header className={styles.header}>
        <Link href="/admin" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            f
          </span>
          <span>
            FamilyOS<small>For parents</small>
          </span>
        </Link>
        {gate.status === "unlocked" && (
          <button
            type="button"
            className={styles.quiet}
            onClick={() => void lock()}
          >
            Lock now
          </button>
        )}
      </header>
      {gate.status !== "unlocked" ? (
        <main className={styles.gate}>
          <div className={styles.eyebrow}>A little space for the grown-ups</div>
          <h1>Welcome home.</h1>
          {gate.status === "checking" && <output>Checking access…</output>}
          {gate.status === "error" && (
            <>
              <p role="alert" className={styles.error}>
                {gate.error}
              </p>
              <button type="button" onClick={() => void checkSession()}>
                Try again
              </button>
            </>
          )}
          {gate.status === "locked" && (
            <form onSubmit={unlock} className={styles.form}>
              <p>
                Enter your household PIN to manage tasks, members, and stars.
              </p>
              <label>
                Six-digit PIN
                <input
                  className={styles.pin}
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, ""))
                  }
                />
              </label>
              {login.error && (
                <p role="alert" className={styles.error}>
                  {login.error}
                </p>
              )}
              <button
                type="submit"
                disabled={login.status === "saving" || pin.length !== 6}
              >
                {login.status === "saving" ? "Unlocking…" : "Unlock admin"}
              </button>
              <p className={styles.muted}>
                Locks after 15 minutes of inactivity.
              </p>
            </form>
          )}
        </main>
      ) : (
        <>
          {pathname !== "/admin" && (
            <nav className={styles.nav} aria-label="Parent admin">
              <Link href="/admin">Home</Link>
              {(["tasks", "members", "stars", "rewards"] as const).map(
                (section) => (
                  <Link
                    key={section}
                    href={`/admin/${section}`}
                    aria-current={
                      pathname === `/admin/${section}` ? "page" : undefined
                    }
                  >
                    {section[0].toUpperCase() + section.slice(1)}
                  </Link>
                ),
              )}
            </nav>
          )}
          <main className={styles.main}>{children}</main>
        </>
      )}
    </div>
  );
}

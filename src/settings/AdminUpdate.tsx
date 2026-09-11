"use client";

import { useEffect, useState } from "react";
import styles from "@/shared/Admin.module.css";
import { adminRequest } from "@/shared/admin-client";
import { Button } from "@/shared/ui/Button";

type UpdateState =
  | {
      status:
        | "checking"
        | "unavailable"
        | "available"
        | "check-error"
        | "starting"
        | "started";
    }
  | { status: "error"; message: string };

export function AdminUpdate() {
  const [state, setState] = useState<UpdateState>({ status: "checking" });

  useEffect(() => {
    if (state.status !== "checking") return;
    let cancelled = false;
    adminRequest<{ available: boolean }>("update")
      .then(({ available }) => {
        if (!cancelled)
          setState({ status: available ? "available" : "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "check-error" });
      });
    return () => {
      cancelled = true;
    };
  }, [state.status]);

  async function update() {
    setState({ status: "starting" });
    try {
      await adminRequest("update", undefined, "POST");
      setState({ status: "started" });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : "Could not start update.",
      });
    }
  }

  if (state.status === "checking" || state.status === "unavailable")
    return null;
  if (state.status === "check-error") {
    return (
      <div style={{ marginTop: 24 }}>
        <p className={styles.muted}>Could not check for updates.</p>
        <Button onClick={() => setState({ status: "checking" })}>
          Retry check
        </Button>
      </div>
    );
  }

  return (
    <section className={styles.card} style={{ marginTop: 24 }}>
      <h2>Update FamilyOS</h2>
      <p className={styles.muted}>
        Install the latest version. FamilyOS will be briefly unavailable while
        the server rebuilds and restarts.
      </p>
      <Button
        variant="primary"
        disabled={state.status === "starting" || state.status === "started"}
        onClick={() => void update()}
      >
        {state.status === "starting"
          ? "Starting…"
          : state.status === "started"
            ? "Update started"
            : "Update"}
      </Button>
      {state.status === "started" && (
        <output style={{ display: "block", marginTop: 16 }}>
          Update started. Refresh this page in a few minutes.
        </output>
      )}
      {state.status === "error" && <p role="alert">{state.message}</p>}
    </section>
  );
}

"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import styles from "./AdminEditorScreen.module.css";
import { Icon } from "./ui/Icon";

export function AdminEditorScreen({
  title,
  backLabel,
  onBack,
  busy,
  children,
}: {
  title: string;
  backLabel: string;
  onBack: () => void;
  busy: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const [phase, setPhase] = useState<"open" | "closing">("open");
  const exitAnimation = useRef<Animation | null>(null);

  async function close() {
    if (busy || phase === "closing" || exitAnimation.current) return;
    const screen = dialog.current;
    if (
      !screen?.animate ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      onBack();
      return;
    }
    setPhase("closing");
    const animation = screen.animate(
      [{ transform: "translateY(0)" }, { transform: "translateY(100%)" }],
      { duration: 220, easing: "ease-in", fill: "forwards" },
    );
    exitAnimation.current = animation;
    try {
      await animation.finished;
      if (screen.isConnected) onBack();
    } catch {
      // Unmounting (for example, session expiry) cancels the animation.
    }
  }

  useEffect(() => {
    const screen = dialog.current;
    screen?.showModal();
    heading.current?.focus();
    return () => {
      exitAnimation.current?.cancel();
      exitAnimation.current = null;
      screen?.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.screen}
      data-phase={phase}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        void close();
      }}
    >
      <header className={styles.navigation}>
        <button
          type="button"
          className={styles.back}
          aria-label={`Back to ${backLabel.toLowerCase()}`}
          disabled={busy || phase === "closing"}
          onClick={() => void close()}
        >
          <Icon name="chevron-down" size={24} />
        </button>
        <h1 id={titleId} ref={heading} tabIndex={-1}>
          {title}
        </h1>
      </header>
      <div className={styles.scroll} inert={phase === "closing"}>
        <div className={styles.content}>
          {typeof children === "function"
            ? children(() => void close())
            : children}
        </div>
      </div>
    </dialog>
  );
}

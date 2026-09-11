import Link from "next/link";
import styles from "@/shared/Admin.module.css";
import { Icon } from "@/shared/ui/Icon";

export default function AdminHome() {
  return (
    <>
      <div className={styles.intro}>
        <div className={styles.eyebrow}>Parent admin</div>
        <h1>
          Make room for a<br />
          smoother day.
        </h1>
        <p className={styles.muted}>
          A few small updates. Everything in its place.
        </p>
      </div>
      <div className={`${styles.cards} ${styles.homeCards}`}>
        <Link
          href="/admin/tasks"
          className={`${styles.card} ${styles.cardLink}`}
        >
          <span aria-hidden="true" className={styles.tile}>
            ✓
          </span>
          <div>
            <h2>Tasks</h2>
            <p>Shape routines, share chores, and correct completions.</p>
          </div>
        </Link>
        <Link
          href="/admin/members"
          className={`${styles.card} ${styles.cardLink}`}
        >
          <span
            aria-hidden="true"
            className={styles.tile}
            style={{ background: "#eee3f0" }}
          >
            ☺
          </span>
          <div>
            <h2>Members</h2>
            <p>Manage your people and their colors.</p>
          </div>
        </Link>
        <Link
          href="/admin/stars"
          className={`${styles.card} ${styles.cardLink}`}
        >
          <span
            aria-hidden="true"
            className={styles.tile}
            style={{ background: "#f6ebcf" }}
          >
            ☆
          </span>
          <div>
            <h2>Stars</h2>
            <p>Review balances and record a correction.</p>
          </div>
        </Link>
        <Link
          href="/admin/rewards"
          className={`${styles.card} ${styles.cardLink}`}
        >
          <span
            aria-hidden="true"
            className={styles.tile}
            style={{ background: "#d6ece9" }}
          >
            <Icon name="gift" size={28} />
          </span>
          <div>
            <h2>Rewards</h2>
            <p>
              Create household rewards, set star costs, and retire old choices.
            </p>
          </div>
        </Link>
      </div>
      <p className={styles.muted} style={{ marginTop: 28 }}>
        On iPhone, use Safari’s Share menu → Add to Home Screen for quick
        access. Connect to home Wi-Fi when making changes.
      </p>
    </>
  );
}

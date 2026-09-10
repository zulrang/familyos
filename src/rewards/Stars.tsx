import { Icon } from "@/shared/ui/Icon";
import styles from "./Rewards.module.css";

export function Stars({
  count,
  literal = false,
}: {
  count: number;
  literal?: boolean;
}) {
  return (
    <span className={styles.stars} role="img" aria-label={`${count} stars`}>
      {literal && count === 0 ? (
        <span>No stars left</span>
      ) : literal && count <= 5 ? (
        ["one", "two", "three", "four", "five"]
          .slice(0, count)
          .map((star) => <Icon key={star} name="star" />)
      ) : (
        <>
          <strong>{count}</strong>
          <span
            className={
              count > 5 && literal ? styles.starStack : styles.singleStar
            }
          >
            {["back", "middle", "front"]
              .slice(0, count > 5 && literal ? 3 : 1)
              .map((star) => (
                <Icon key={star} name="star" />
              ))}
          </span>
        </>
      )}
    </span>
  );
}

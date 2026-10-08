// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { EventCard } from "./EventCard";

describe("EventCard", () => {
  test("timed event title and time use on-fill ink", () => {
    render(
      <EventCard
        title="Piano"
        time="3:00 – 4:00p"
        fill="#1a2744"
        ink="#ffffff"
      />,
    );
    expect(screen.getByRole("button")).toHaveStyle({ color: "#ffffff" });
    expect(screen.getByText("3:00 – 4:00p")).toHaveStyle({ color: "#ffffff" });
  });

  test("an event that has ended is dimmed", () => {
    render(<EventCard title="Dentist" past />);
    expect(screen.getByRole("button", { name: "Dentist" })).toHaveStyle({
      opacity: "0.55",
    });
  });

  test("a current event is not dimmed", () => {
    render(<EventCard title="Art club" />);
    expect(screen.getByRole("button", { name: "Art club" })).toHaveStyle({
      opacity: "1",
    });
  });
});

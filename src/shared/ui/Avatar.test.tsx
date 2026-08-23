// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Avatar } from "./Avatar";

describe("Avatar", () => {
  test("custom Member Color surfaces use soft fill and ink", () => {
    render(<Avatar name="Ada" surface={{ soft: "#aecdee", ink: "#2b4761" }} />);
    expect(screen.getByTitle("Ada")).toHaveStyle({
      background: "#aecdee",
      color: "#2b4761",
    });
  });
});

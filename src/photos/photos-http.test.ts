import { expect, test, vi } from "vitest";
import { handlePhotos } from "./photos-http";

vi.mock("@/shared/display-auth", () => ({
  requireTrustedDisplay: async () => ({}),
  isUnauthorized: (value: unknown) => value instanceof Response,
}));
vi.mock("./photos-service", async () => {
  const { AuthError } = await import("@/shared/auth-error");
  return {
    pollPhotos: async () => {
      throw new AuthError();
    },
    logPhotosRequestFailure: () => {},
  };
});

test("a Google authorization failure returns a safe 401 response", async () => {
  const response = await handlePhotos(
    new Request("http://localhost/api/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "poll" }),
    }),
  );
  expect(response.status).toBe(401);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    error: "Google Photos authorization expired. Connect again.",
  });
});

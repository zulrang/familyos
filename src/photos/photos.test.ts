import { describe, expect, test } from "vitest";
import { parsePickerSession } from "./google-photos";

describe("Google Photos Picker response boundary", () => {
  test("parses the picker session and provider polling interval", () => {
    expect(
      parsePickerSession({
        id: "session",
        pickerUri: "https://photos.google.com/picker",
        mediaItemsSet: false,
        expireTime: "2030-01-01T00:00:00Z",
        pollingConfig: { pollInterval: "12.5s" },
      }),
    ).toMatchObject({
      id: "session",
      pickerUrl: "https://photos.google.com/picker",
      mediaItemsSet: false,
      pollAfterMs: 12500,
    });
  });
  test("rejects malformed sessions", () => {
    expect(() =>
      parsePickerSession({ pickerUri: "https://photos.google.com/picker" }),
    ).toThrow();
  });
});

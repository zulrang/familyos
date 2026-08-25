import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { describe, test } from "vitest";
import { checkTree, scanFile } from "../scripts/import-boundaries";

describe("slice import boundaries", () => {
  test("a Lists module cannot import Calendar", () => {
    const hits = scanFile(
      "src/lists/ListsScreen.tsx",
      `import { CalendarScreen } from "@/calendar/CalendarScreen";`,
    );
    assert.equal(hits.length, 1);
  });

  test("shared cannot import a slice", () => {
    const hits = scanFile(
      "src/shared/display-auth.ts",
      `import { handlePair } from "@/displays/pairing-http";`,
    );
    assert.equal(hits.length, 1);
  });

  test("settings cannot import Calendar", () => {
    const hits = scanFile(
      "src/settings/settings.ts",
      `import { listCalendars } from "@/calendar/google-events";`,
    );
    assert.equal(hits.length, 1);
  });

  test("settings-http may dynamically import listCalendars", () => {
    const hits = scanFile(
      "src/settings/settings-http.ts",
      `const { listCalendars } = await import("@/calendar/google-events");`,
    );
    assert.equal(hits.length, 0);
  });

  test("settings-http may not statically import Calendar", () => {
    const hits = scanFile(
      "src/settings/settings-http.ts",
      `import { listCalendars } from "@/calendar/google-events";`,
    );
    assert.equal(hits.length, 1);
  });

  test("a test file may import another slice for HTTP setup", () => {
    const hits = scanFile(
      "src/lists/lists-http.test.ts",
      `import { handlePair } from "@/displays/pairing-http";`,
    );
    assert.equal(hits.length, 0);
  });

  test("a test file still cannot import kiosk/", () => {
    const hits = scanFile(
      "src/lists/lists-http.test.ts",
      `import { osk } from "../../kiosk/osk/index.js";`,
    );
    assert.equal(hits.length, 1);
  });

  test("a route file may import its slice", () => {
    const hits = scanFile(
      "src/app/page.tsx",
      `import { CalendarScreen } from "@/calendar/CalendarScreen";`,
    );
    assert.equal(hits.length, 0);
  });

  test("displays may import display session/auth from shared", () => {
    const hits = scanFile(
      "src/displays/pairing-http.ts",
      `import { requireTrustedDisplay } from "@/shared/display-auth";`,
    );
    assert.equal(hits.length, 0);
  });

  test("the Next app cannot import kiosk/", () => {
    const hits = scanFile(
      "src/app/layout.tsx",
      `import { osk } from "../../kiosk/osk/index.js";`,
    );
    assert.equal(hits.length, 1);
  });

  test("a relative import of kiosk without a nested path is still forbidden", () => {
    const hits = scanFile("src/app/layout.tsx", `import k from "../../kiosk";`);
    assert.equal(hits.length, 1);
  });

  test("the Next app cannot import the design skill", () => {
    const hits = scanFile(
      "src/shared/NavRail.tsx",
      `import ds from "../../.cursor/skills/familyos-design/readme.md";`,
    );
    assert.equal(hits.length, 1);
  });

  test("a forbidden import in source fails the tree check", async () => {
    const probe = "src/lists/__boundary-probe.ts";
    await writeFile(probe, `import { x } from "@/calendar/calendar";\n`);
    try {
      const hits = checkTree("src");
      assert.ok(hits.some((h) => h.from.endsWith("__boundary-probe.ts")));
    } finally {
      await unlink(probe);
    }
  });

  test("the Next app source tree has no forbidden imports", () => {
    assert.deepEqual(checkTree("src"), []);
  });
});

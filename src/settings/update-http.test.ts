import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { handleAdminSession } from "@/shared/admin-auth";
import { handleAdminUpdate, handleAdminUpdateCheck } from "./update-http";

let dir: string;
let cookie: string;

function request(origin = "http://familyos.test", credentials = cookie) {
  return new Request("http://familyos.test/admin/api/update", {
    method: "POST",
    headers: {
      origin,
      cookie: credentials,
      "x-familyos-admin": "1",
    },
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "familyos-update-"));
  vi.stubEnv("FAMILYOS_DATA_DIR", dir);
  vi.stubEnv("FAMILYOS_ADMIN_PIN", "123456");
  vi.stubEnv("FAMILYOS_MACOS_SERVER", path.join(dir, "server"));
  await writeFile(
    path.join(dir, "server"),
    '#!/bin/sh\nprintf "%s" "$1" > "$FAMILYOS_DATA_DIR/receipt"\n',
    { mode: 0o700 },
  );
  const response = await handleAdminSession(
    new Request("http://familyos.test/admin/api/session", {
      method: "POST",
      headers: { origin: "http://familyos.test", "x-familyos-admin": "1" },
      body: JSON.stringify({ pin: "123456" }),
    }),
  );
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

test("an authenticated admin launches the independent update job", async () => {
  const response = await handleAdminUpdate(request());
  expect(response.status).toBe(202);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await readFile(path.join(dir, "receipt"), "utf8")).toBe("kick-update");
});

test("unauthenticated and cross-origin requests cannot launch an update", async () => {
  expect(
    (await handleAdminUpdate(request("http://familyos.test", ""))).status,
  ).toBe(401);
  expect((await handleAdminUpdate(request("http://other.test"))).status).toBe(
    403,
  );
  await expect(readFile(path.join(dir, "receipt"))).rejects.toThrow();
});

test("launch failures return an error without claiming the update started", async () => {
  await writeFile(path.join(dir, "server"), "#!/bin/sh\nexit 1\n");
  const response = await handleAdminUpdate(request());
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Could not start update." });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

function checkRequest(credentials = cookie) {
  return new Request("http://familyos.test/admin/api/update", {
    headers: { cookie: credentials },
  });
}

test.each([
  true,
  false,
])("reports update availability: %s", async (available) => {
  await writeFile(
    path.join(dir, "server"),
    `#!/bin/sh
echo '{"available":${available}}'
`,
  );
  const response = await handleAdminUpdateCheck(checkRequest());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ available });
});

test("requires an admin session before checking the remote", async () => {
  expect((await handleAdminUpdateCheck(checkRequest(""))).status).toBe(401);
  await expect(readFile(path.join(dir, "receipt"))).rejects.toThrow();
});

test("a failed or invalid check is not reported as up to date", async () => {
  for (const body of [
    "exit 1",
    "echo invalid",
    `echo '{"available":"false"}'`,
  ]) {
    await writeFile(
      path.join(dir, "server"),
      `#!/bin/sh
${body}
`,
    );
    const response = await handleAdminUpdateCheck(checkRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Could not check for updates.",
    });
  }
});

import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type ServerFixture = {
  uid: number;
  serverPlist: string;
  updatePlist: string;
  installServerPlist: () => Promise<void>;
  run: (args: string[], bootstrapExit?: string) => Promise<CommandResult>;
  readCalls: () => Promise<string[]>;
};

function runMacosServer(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "bash",
      ["scripts/macos-server", ...args],
      { cwd, env },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number") {
          resolve({ code: error.code, stdout, stderr });
          return;
        }
        reject(error);
      },
    );
  });
}

async function writeExecutable(filePath: string, content: string) {
  await writeFile(filePath, content, { mode: 0o755 });
}

async function withServerFixture(
  fn: (fixture: ServerFixture) => Promise<void>,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "familyos-macos-server-"));
  const checkout = path.join(dir, "checkout");
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  const logFile = path.join(dir, "stub.log");
  const portUpFile = path.join(dir, "port-up");
  const serverPlist = path.join(
    home,
    "Library/LaunchAgents/com.familyos.server.plist",
  );
  const updatePlist = path.join(
    home,
    "Library/LaunchAgents/com.familyos.update.plist",
  );
  const uid = process.getuid ? process.getuid() : 0;

  try {
    await mkdir(path.join(checkout, "scripts"), { recursive: true });
    await mkdir(home, { recursive: true });
    await mkdir(bin, { recursive: true });
    await copyFile(
      "scripts/macos-server",
      path.join(checkout, "scripts/macos-server"),
    );

    await writeExecutable(
      path.join(bin, "uname"),
      `#!/bin/sh
echo Darwin
`,
    );
    await writeExecutable(
      path.join(bin, "plutil"),
      `#!/bin/sh
printf 'plutil %s\\n' "$*" >> "$STUB_LOG"
`,
    );
    await writeExecutable(
      path.join(bin, "lsof"),
      `#!/bin/sh
[ -f "$STUB_PORT_UP" ]
`,
    );
    await writeExecutable(
      path.join(bin, "launchctl"),
      `#!/bin/sh
printf 'launchctl %s\\n' "$*" >> "$STUB_LOG"
case "$1" in
  managername)
    echo Background
    ;;
  bootout | enable)
    exit 0
    ;;
  print)
    exit 1
    ;;
  bootstrap)
    code="\${STUB_BOOTSTRAP_EXIT:-0}"
    if [ "$code" -eq 0 ]; then
      : > "$STUB_PORT_UP"
    fi
    exit "$code"
    ;;
  kickstart)
    : > "$STUB_PORT_UP"
    exit 0
    ;;
esac
`,
    );

    const fixture: ServerFixture = {
      uid,
      serverPlist,
      updatePlist,
      installServerPlist: async () => {
        await mkdir(path.dirname(serverPlist), { recursive: true });
        await writeFile(serverPlist, "<plist/>\n");
      },
      run: async (args, bootstrapExit = "0") => {
        await rm(logFile, { force: true });
        await rm(portUpFile, { force: true });
        return runMacosServer(checkout, args, {
          ...process.env,
          HOME: home,
          PATH: `${bin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          STUB_LOG: logFile,
          STUB_PORT_UP: portUpFile,
          STUB_BOOTSTRAP_EXIT: bootstrapExit,
        });
      },
      readCalls: async () => {
        const raw = await readFile(logFile, "utf8");
        return raw.split("\n").filter((line) => line.length > 0);
      },
    };

    await fn(fixture);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("scripts/macos-server launchctl bootstrap handling", () => {
  test("start_agent succeeds without kickstart on normal bootstrap", async () => {
    await withServerFixture(async (fixture) => {
      await fixture.installServerPlist();
      const result = await fixture.run(["restart"], "0");
      const calls = await fixture.readCalls();

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("FamilyOS listening on :3000");
      expect(calls).toContain(
        `launchctl bootstrap user/${fixture.uid} ${fixture.serverPlist}`,
      );
      expect(calls.some((line) => line.startsWith("launchctl kickstart"))).toBe(
        false,
      );
      expect(calls).toContain(
        `launchctl enable user/${fixture.uid}/com.familyos.server`,
      );
    });
  });

  test("start_agent kickstarts and enables when bootstrap exits 5 (already loaded)", async () => {
    await withServerFixture(async (fixture) => {
      await fixture.installServerPlist();
      const result = await fixture.run(["restart"], "5");
      const calls = await fixture.readCalls();

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("FamilyOS listening on :3000");
      expect(calls).toContain(
        `launchctl bootstrap user/${fixture.uid} ${fixture.serverPlist}`,
      );
      expect(calls).toContain(
        `launchctl kickstart -k user/${fixture.uid}/com.familyos.server`,
      );
      expect(calls).toContain(
        `launchctl enable user/${fixture.uid}/com.familyos.server`,
      );
    });
  });

  test("start_agent preserves non-5 bootstrap failure exit code", async () => {
    await withServerFixture(async (fixture) => {
      await fixture.installServerPlist();
      const result = await fixture.run(["restart"], "125");
      const calls = await fixture.readCalls();

      expect(result.code).toBe(125);
      expect(calls).toContain(
        `launchctl bootstrap user/${fixture.uid} ${fixture.serverPlist}`,
      );
      expect(calls.some((line) => line.startsWith("launchctl kickstart"))).toBe(
        false,
      );
      expect(calls.some((line) => line.startsWith("launchctl enable"))).toBe(
        false,
      );
    });
  });

  test("bootstrap_user_job succeeds on normal bootstrap", async () => {
    await withServerFixture(async (fixture) => {
      const result = await fixture.run(["kick-update"], "0");
      const calls = await fixture.readCalls();

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        `Update job started (user/${fixture.uid}/com.familyos.update).`,
      );
      expect(calls).toContain(`plutil -lint ${fixture.updatePlist}`);
      expect(calls).toContain(
        `launchctl bootstrap user/${fixture.uid} ${fixture.updatePlist}`,
      );
      expect(calls).toContain(
        `launchctl enable user/${fixture.uid}/com.familyos.update`,
      );
      expect(calls).toContain(
        `launchctl kickstart -k user/${fixture.uid}/com.familyos.update`,
      );
    });
  });

  test("bootstrap_user_job succeeds when bootstrap exits 5 (already loaded)", async () => {
    await withServerFixture(async (fixture) => {
      const result = await fixture.run(["kick-update"], "5");
      const calls = await fixture.readCalls();

      expect(result.code).toBe(0);
      expect(calls).toContain(
        `launchctl bootstrap user/${fixture.uid} ${fixture.updatePlist}`,
      );
      expect(calls).toContain(
        `launchctl enable user/${fixture.uid}/com.familyos.update`,
      );
      expect(calls).toContain(
        `launchctl kickstart -k user/${fixture.uid}/com.familyos.update`,
      );
    });
  });

  test("bootstrap_user_job preserves non-5 bootstrap failure exit code and message", async () => {
    await withServerFixture(async (fixture) => {
      const result = await fixture.run(["kick-update"], "125");
      const calls = await fixture.readCalls();

      expect(result.code).toBe(125);
      expect(result.stderr).toContain(
        `Could not bootstrap com.familyos.update into user/${fixture.uid} (exit 125).`,
      );
      expect(calls).toContain(
        `launchctl bootstrap user/${fixture.uid} ${fixture.updatePlist}`,
      );
      expect(calls.some((line) => line.startsWith("launchctl enable"))).toBe(
        false,
      );
      expect(calls.some((line) => line.startsWith("launchctl kickstart"))).toBe(
        false,
      );
    });
  });
});

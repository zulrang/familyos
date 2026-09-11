import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);

test("checks actual remote history without changing the checkout", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "familyos-update-git-"));
  const remote = path.join(dir, "remote.git");
  const local = path.join(dir, "local");
  const publisher = path.join(dir, "publisher");
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  const git = (cwd: string, ...args: string[]) =>
    exec("git", args, { cwd, env });
  try {
    await git(dir, "init", "--bare", "--initial-branch=main", remote);
    await git(dir, "clone", remote, local);
    await git(local, "commit", "--allow-empty", "-m", "Initial");
    await git(local, "push", "origin", "main");
    await git(dir, "clone", remote, publisher);
    await mkdir(path.join(local, "scripts"));
    await copyFile(
      "scripts/macos-server",
      path.join(local, "scripts/macos-server"),
    );
    const check = async () => {
      const { stdout } = await exec(
        "bash",
        ["scripts/macos-server", "check-update"],
        { cwd: local, env },
      );
      return JSON.parse(stdout);
    };

    expect(await check()).toEqual({ available: false });
    await git(local, "commit", "--allow-empty", "-m", "Local ahead");
    expect(await check()).toEqual({ available: false });
    await git(local, "checkout", "-b", "preview");
    await writeFile(path.join(local, "draft.txt"), "unsaved work");
    const before = (await git(local, "status", "--porcelain")).stdout;
    await git(publisher, "commit", "--allow-empty", "-m", "Remote update");
    await git(publisher, "push", "origin", "main");
    expect(await check()).toEqual({ available: true });
    expect((await git(local, "branch", "--show-current")).stdout.trim()).toBe(
      "preview",
    );
    expect((await git(local, "status", "--porcelain")).stdout).toBe(before);
    // Local main catches up, while the checked-out preview branch stays behind.
    await git(local, "branch", "-f", "main", "origin/main");
    expect(await check()).toEqual({ available: false });
    await git(
      local,
      "remote",
      "set-url",
      "origin",
      path.join(dir, "missing.git"),
    );
    await expect(check()).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

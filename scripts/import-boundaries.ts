import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Slice import boundary config — docs/code-design-principles.md #3.
// Feature slices: calendar, lists, displays. Platform/household: members, settings.
const FEATURE_SLICES = new Set(["calendar", "lists", "displays"]);
const SLICES = new Set([
  "calendar",
  "lists",
  "displays",
  "members",
  "settings",
]);
const SETTINGS_HTTP = "src/settings/settings-http.ts";
const LIST_CALENDARS = "src/calendar/google-events";

function posix(p: string): string {
  return p.replaceAll("\\", "/");
}

function srcDirOf(repoPath: string): string | null {
  const m = stripExt(repoPath).match(
    /^src\/(calendar|lists|displays|members|settings|shared)(?:\/|$)/,
  );
  return m ? m[1] : null;
}

function stripExt(p: string): string {
  return posix(p).replace(/\.(tsx?|jsx?|mts|cts)$/, "");
}

function isTestFile(file: string): boolean {
  return /\.test\.(tsx?|jsx?|mts|cts)$/.test(posix(file));
}

function isKioskOrSkill(to: string): boolean {
  return (
    to === "kiosk" ||
    to.startsWith("kiosk/") ||
    to === ".cursor/skills" ||
    to.startsWith(".cursor/skills/")
  );
}

export function resolveImport(
  fromFile: string,
  specifier: string,
): string | null {
  if (specifier.startsWith("@/")) {
    return posix(path.posix.join("src", specifier.slice(2)));
  }
  if (isKioskOrSkill(specifier)) {
    return specifier;
  }
  if (specifier.startsWith(".")) {
    return posix(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(fromFile), specifier),
      ),
    );
  }
  return null;
}

export function forbiddenReason(
  fromFile: string,
  toFile: string,
  dynamic = false,
): string | null {
  const from = posix(fromFile);
  const to = posix(toFile);
  if (isKioskOrSkill(to)) {
    return `${from} must not import ${to}`;
  }
  // DESIGN-DEVIATION: HTTP tests compose pairing via displays/pairing-http.
  // Slice rules apply to production sources; kiosk/skill bans still apply above.
  if (isTestFile(from)) return null;
  const fromSlice = srcDirOf(from);
  const toSlice = srcDirOf(to);
  if (fromSlice === "shared" && toSlice && SLICES.has(toSlice)) {
    return `shared must not import slice ${toSlice}`;
  }
  if (
    fromSlice &&
    toSlice &&
    FEATURE_SLICES.has(fromSlice) &&
    FEATURE_SLICES.has(toSlice) &&
    fromSlice !== toSlice
  ) {
    return `feature slice ${fromSlice} must not import ${toSlice}`;
  }
  if (
    (fromSlice === "settings" || fromSlice === "members") &&
    toSlice &&
    FEATURE_SLICES.has(toSlice)
  ) {
    if (dynamic && from === SETTINGS_HTTP && stripExt(to) === LIST_CALENDARS) {
      return null;
    }
    return `${fromSlice} must not import feature slice ${toSlice}`;
  }
  return null;
}

type Specifier = { specifier: string; dynamic: boolean };

export function importSpecifiers(source: string): Specifier[] {
  const sf = ts.createSourceFile(
    "probe.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const out: Specifier[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push({ specifier: node.moduleSpecifier.text, dynamic: false });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push({ specifier: node.arguments[0].text, dynamic: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export function scanFile(
  fromFile: string,
  source: string,
): { to: string; reason: string }[] {
  const hits: { to: string; reason: string }[] = [];
  for (const { specifier, dynamic } of importSpecifiers(source)) {
    const to = resolveImport(fromFile, specifier);
    if (!to) continue;
    const reason = forbiddenReason(fromFile, to, dynamic);
    if (reason) hits.push({ to, reason });
  }
  return hits;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".next") continue;
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function isScannedSource(file: string): boolean {
  const p = posix(file);
  if (!/\.(tsx?|jsx?|mts|cts)$/.test(p)) return false;
  if (p.endsWith(".d.ts")) return false;
  return true;
}

export function checkTree(
  root: string,
): { from: string; to: string; reason: string }[] {
  const hits: { from: string; to: string; reason: string }[] = [];
  for (const file of walkFiles(root)) {
    if (!isScannedSource(file)) continue;
    const from = posix(file);
    const source = readFileSync(file, "utf8");
    for (const hit of scanFile(from, source)) {
      hits.push({ from, ...hit });
    }
  }
  return hits;
}

import path from "node:path";

/** Server-local data root. Overridable for isolated HTTP checks. */
export function dataDir(): string {
  return process.env.FAMILYOS_DATA_DIR ?? path.join(process.cwd(), "data");
}

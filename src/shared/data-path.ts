import path from "node:path";

export function dataDir(): string {
  return process.env.FAMILYOS_DATA_DIR ?? path.join(process.cwd(), "data");
}

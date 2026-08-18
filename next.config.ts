import os from "node:os";
import type { NextConfig } from "next";

function lanHosts(): string[] {
  const hosts = new Set<string>([os.hostname(), `${os.hostname()}.local`]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.internal || a.family !== "IPv4") continue;
      hosts.add(a.address);
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  reactCompiler: true,
  allowedDevOrigins: lanHosts(),
};

export default nextConfig;

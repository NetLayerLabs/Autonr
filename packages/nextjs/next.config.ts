import { config as loadEnv } from "dotenv";
import { existsSync } from "fs";
import type { NextConfig } from "next";
import path from "path";

// The agent CLIs and this dashboard share one env file. Variables already present in the environment win (no
// override), so a hosting provider can still set or replace any of them. Nothing here is exposed to the browser:
// Next only inlines NEXT_PUBLIC_* variables into client bundles.
const agentEnvFile = path.join(__dirname, "../agent/.env");
if (existsSync(agentEnvFile)) {
  loadEnv({ path: agentEnvFile });
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../.."),
  reactStrictMode: true,
  devIndicators: false,
  // @sh/agent ships TypeScript sources without a build step.
  transpilePackages: ["@sh/agent"],
  typescript: {
    ignoreBuildErrors: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
  },
  eslint: {
    ignoreDuringBuilds: process.env.NEXT_PUBLIC_IGNORE_BUILD_ERROR === "true",
    // next lint only scans app, components, lib, pages and src unless told otherwise.
    dirs: ["app", "components", "hooks", "lib", "services", "utils"],
  },
  webpack: (config, { dev, webpack }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // RainbowKit -> wagmi connectors -> @base-org/account -> @coinbase/cdp-sdk statically imports its *optional* x402
    // peers. npm does not install optional peers, so a fresh npm scaffold fails to build. This app never calls
    // Coinbase's x402 helpers, so the imports are safe to drop.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    if (dev) {
      config.watchOptions = {
        followSymlinks: true,
      };
      config.snapshot = { ...(config.snapshot as object), managedPaths: [] };
    }
    return config;
  },
};

export default nextConfig;

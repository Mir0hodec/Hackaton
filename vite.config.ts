import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { readExecutionProfile } from "./scripts/execution-profile.mjs";
import { sites } from "./build/sites-vite-plugin";
import { connectorPreview } from "./build/connector-preview-plugin.mjs";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const managedLinux = readExecutionProfile() === "managed-linux";

// НарядAI: собственный деплой в Cloudflare (scripts/deploy-cloudflare.mjs) передаёт реальные
// ресурсы через переменные окружения. Без них сборка остаётся такой же, как для ChatGPT Sites.
const ownCloudflare = process.env.NARYADAI_CF_D1_ID
  ? {
      name: process.env.NARYADAI_CF_NAME || "naryadai",
      d1Name: process.env.NARYADAI_CF_D1_NAME || "naryadai",
      d1Id: process.env.NARYADAI_CF_D1_ID,
      bucket: process.env.NARYADAI_CF_BUCKET || "naryadai-photos",
    }
  : null;

const localBindingConfig = {
  main: "./build/sites-worker.ts",
  compatibility_flags: ["nodejs_compat"],
  ...(ownCloudflare
    ? { name: ownCloudflare.name, triggers: { crons: ["* * * * *"] } }
    : {}),
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: ownCloudflare?.d1Name || "site-creator-d1",
          database_id: ownCloudflare?.d1Id || SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  // NARYADAI_CF_BUCKET=none — R2 не включён в аккаунте, фото хранятся в D1 (lib/server.ts).
  r2_buckets: r2 && ownCloudflare?.bucket !== "none"
    ? [
        {
          binding: r2,
          bucket_name: ownCloudflare?.bucket || "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command }) => {
  // Use Miniflare's local Request.cf placeholder unless fetching is requested.
  process.env.CLOUDFLARE_CF_FETCH_ENABLED ??= "false";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_REGISTRY_PATH ??= ".wrangler/dev-registry";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      ...(managedLinux
        ? { host: "0.0.0.0", allowedHosts: ["terminal.local"] }
        : {}),
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites({ mockAuth: !managedLinux }),
      connectorPreview(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: {
          ...localBindingConfig,
          ...(command === "serve"
            ? {
                services: [
                  {
                    binding: "CONNECTORS",
                    service: "sites-connector-preview",
                    entrypoint: "ConnectorPreview",
                  },
                ],
              }
            : {}),
        },
        ...(command === "serve"
          ? {
              auxiliaryWorkers: [
                {
                  config: {
                    name: "sites-connector-preview",
                    main: "./build/connector-preview-worker.mjs",
                    compatibility_date: "2026-05-15",
                  },
                },
              ],
            }
          : {}),
      }),
    ],
  };
});

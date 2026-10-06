import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
  // НарядAI: Cron Trigger (Cloudflare) проверяет сроки нарядов, даже когда все окна приложения закрыты.
  // На хостингах без cron-триггеров обработчик просто не вызывается.
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    const { initialize } = await import("../lib/server");
    const { checkDeadlines } = await import("../lib/deadlines");
    const origin = (env as any).PUBLIC_ORIGIN || "https://naryadai.app";
    ctx.waitUntil(initialize().then(() => checkDeadlines(origin)).then(
      (created) => console.log("deadline check:", created),
      (error) => console.error("deadline check failed:", error),
    ));
  },
};

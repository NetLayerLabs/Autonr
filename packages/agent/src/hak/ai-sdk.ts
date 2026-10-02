import { type Configuration, HederaAgentAPI, ToolDiscovery } from "@hashgraph/hedera-agent-kit";
import { type Client } from "@hiero-ledger/sdk";
import { type FlexibleSchema, tool, type ToolSet } from "ai";

/**
 * HAK tools as a Vercel AI SDK tool set, built the way HAK's own `HederaAIToolkit` builds it: `ToolDiscovery` collects
 * the plugins' tools and `HederaAgentAPI` runs them with the client, the context and its hooks. HAK's adapter package
 * (`@hashgraph/hedera-agent-kit-ai-sdk` 2.x) needs AI SDK 7 and Node.js 22, while this template targets AI SDK 6 and
 * Node.js 20.18, so the same few lines live here on top of the core kit.
 */
export function hederaAiSdkTools(client: Client, configuration: Configuration): ToolSet {
  const context = configuration.context ?? {};
  const tools = ToolDiscovery.createFromConfiguration(configuration).getAllTools(context, configuration);
  const api = new HederaAgentAPI(client, context, tools);
  return Object.fromEntries(
    tools.map(hakTool => [
      hakTool.method,
      tool({
        description: hakTool.description,
        // Typed with HAK's zod 3 copy; at runtime a zod schema the AI SDK reads directly.
        inputSchema: hakTool.parameters as unknown as FlexibleSchema<Record<string, unknown>>,
        execute: async input => JSON.parse(await api.run(hakTool.method, input)) as unknown,
      }),
    ]),
  );
}

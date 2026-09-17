import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface McpServerHandle {
  name: string;
  client: Client;
}

function serverEntryPath(fileName: string): string {
  return path.join(__dirname, "servers", fileName);
}

/**
 * Spawns an MCP server as a child process (over stdio) and connects an MCP
 * client to it. Each server is launched with the same Node binary running
 * this app, using `--import tsx` so the TypeScript server file can run
 * directly without a separate build step.
 */
async function connectStdioServer(name: string, entryFile: string): Promise<McpServerHandle> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverEntryPath(entryFile)],
  });

  const client = new Client({ name: `travel-assistant-${name}-client`, version: "1.0.0" });
  await client.connect(transport);
  return { name, client };
}

export class McpToolProvider {
  private servers: McpServerHandle[] = [];

  async connect(): Promise<void> {
    this.servers = await Promise.all([
      connectStdioServer("weather", "weatherServer.ts"),
      connectStdioServer("currency", "currencyServer.ts"),
    ]);
  }

  async close(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.client.close()));
  }

  private getClient(name: "weather" | "currency"): Client {
    const handle = this.servers.find((s) => s.name === name);
    if (!handle) {
      throw new Error(`MCP server "${name}" is not connected.`);
    }
    return handle.client;
  }

  get weatherClient(): Client {
    return this.getClient("weather");
  }

  get currencyClient(): Client {
    return this.getClient("currency");
  }
}

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { McpToolProvider } from "./client.js";

interface McpToolOutcome {
  ok: boolean;
  source: "mcp";
  toolName: string;
  data?: unknown;
  error?: string;
}

function extractText(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("\n");
}

/**
 * Calls an MCP tool and normalises the outcome into a shape the agent can
 * reason about honestly: `ok: false` (with a human-readable `error`) covers
 * both tool-reported failures (isError) and transport/connection failures
 * (e.g. the MCP server process died), so the agent is instructed to say the
 * information is unavailable rather than inventing an answer.
 */
async function callMcpTool(
  client: Client,
  toolName: string,
  args: Record<string, unknown>
): Promise<McpToolOutcome> {
  try {
    const result = await client.callTool({ name: toolName, arguments: args });
    const text = extractText(result as { content?: Array<{ type: string; text?: string }> });

    if ((result as { isError?: boolean }).isError) {
      let message = text;
      try {
        message = JSON.parse(text).error ?? text;
      } catch {
        // text wasn't JSON; use as-is
      }
      return { ok: false, source: "mcp", toolName, error: message };
    }

    return { ok: true, source: "mcp", toolName, data: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      source: "mcp",
      toolName,
      error:
        `MCP tool "${toolName}" is currently unavailable ` +
        `(${error instanceof Error ? error.message : "unknown transport error"}).`,
    };
  }
}

export function createMcpLangChainTools(provider: McpToolProvider) {
  const weatherTool = tool(
    async ({ location, days }: { location: string; days?: number }) => {
      const outcome = await callMcpTool(provider.weatherClient, "get_weather_forecast", {
        location,
        days,
      });
      return JSON.stringify(outcome);
    },
    {
      name: "get_weather_forecast",
      description:
        "Calls the MCP weather tool to retrieve CURRENT conditions and an up-to-7-day " +
        "forecast for a location. This is the ONLY source of weather/forecast information - " +
        "never guess or rely on general climate knowledge for a specific date. Returns a " +
        "JSON object; check 'ok' before using 'data', and surface 'error' honestly if 'ok' is " +
        "false instead of fabricating a forecast.",
      schema: z.object({
        location: z.string().describe('Destination to check, e.g. "Singapore".'),
        days: z
          .number()
          .optional()
          .describe(
            "Number of forecast days requested, including today (default 3, max 7)."
          ),
      }),
    }
  );

  const currencyTool = tool(
    async ({ amount, from, to }: { amount: number; from: string; to: string }) => {
      const outcome = await callMcpTool(provider.currencyClient, "convert_currency", {
        amount,
        from,
        to,
      });
      return JSON.stringify(outcome);
    },
    {
      name: "convert_currency",
      description:
        "Calls the MCP currency-conversion tool to convert an amount between two ISO 4217 " +
        "currency codes using current exchange rates. This is the ONLY source of exchange-" +
        "rate information - never guess a rate. Returns a JSON object; check 'ok' before " +
        "using 'data', and surface 'error' honestly if 'ok' is false instead of fabricating " +
        "a rate.",
      schema: z.object({
        amount: z.number().describe("Amount of money to convert (must be positive)."),
        from: z.string().describe('3-letter ISO currency code to convert from, e.g. "INR".'),
        to: z.string().describe('3-letter ISO currency code to convert to, e.g. "SGD".'),
      }),
    }
  );

  return [weatherTool, currencyTool];
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Standalone MCP server exposing a single "convert_currency" tool backed by
 * the free Frankfurter API (ECB reference rates, no API key required). Runs
 * over stdio so it can be launched either by the travel assistant's MCP
 * client, or independently by any other MCP-compatible host.
 */

async function convert(amount: number, from: string, to: string) {
  const url = `https://api.frankfurter.app/latest?amount=${amount}&from=${encodeURIComponent(
    from.toUpperCase()
  )}&to=${encodeURIComponent(to.toUpperCase())}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Currency service returned HTTP ${res.status}${body ? `: ${body}` : ""}`
    );
  }
  const data = (await res.json()) as {
    amount: number;
    base: string;
    date: string;
    rates: Record<string, number>;
  };

  const convertedAmount = data.rates[to.toUpperCase()];
  if (convertedAmount === undefined) {
    throw new Error(`No rate returned for target currency "${to}".`);
  }

  return {
    amount,
    from: from.toUpperCase(),
    to: to.toUpperCase(),
    convertedAmount,
    rateDate: data.date,
    provider: "Frankfurter (frankfurter.app, ECB reference rates)",
    retrievedAt: new Date().toISOString(),
  };
}

const server = new McpServer({ name: "travel-currency-mcp", version: "1.0.0" });

server.tool(
  "convert_currency",
  "Converts an amount from one currency to another using current ECB reference exchange " +
    "rates. Use this whenever the user asks to convert money, check an exchange rate, or " +
    "express a travel budget in a different currency. Currency codes are ISO 4217 (e.g. " +
    "INR, SGD, USD, EUR, GBP).",
  {
    amount: z.number().positive().describe("The amount of money to convert."),
    from: z.string().length(3).describe('The 3-letter ISO currency code to convert from, e.g. "INR".'),
    to: z.string().length(3).describe('The 3-letter ISO currency code to convert to, e.g. "SGD".'),
  },
  async ({ amount, from, to }) => {
    try {
      const result = await convert(amount, from, to);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown currency tool error",
            }),
          },
        ],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

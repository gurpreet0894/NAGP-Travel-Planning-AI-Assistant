import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Standalone MCP server exposing a single "get_weather_forecast" tool backed
 * by the free Open-Meteo API (no API key required). Runs over stdio so it
 * can be launched either by the travel assistant's MCP client, or
 * independently by any other MCP-compatible host.
 */

const WMO_WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WMO_WEATHER_CODES[code] ?? `Unknown conditions (WMO code ${code})`;
}

async function geocodeLocation(location: string): Promise<{ name: string; latitude: number; longitude: number; country: string }> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Geocoding service returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    results?: Array<{ name: string; latitude: number; longitude: number; country: string }>;
  };
  const first = data.results?.[0];
  if (!first) {
    throw new Error(`Could not resolve location "${location}" to a place.`);
  }
  return first;
}

async function fetchForecast(latitude: number, longitude: number, days: number) {
  const clampedDays = Math.min(Math.max(days, 1), 7);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&current_weather=true` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode` +
    `&timezone=auto&forecast_days=${clampedDays}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather service returned HTTP ${res.status}`);
  }
  return res.json() as Promise<{
    current_weather?: { temperature: number; weathercode: number; time: string };
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      precipitation_probability_max: number[];
      weathercode: number[];
    };
  }>;
}

const server = new McpServer({ name: "travel-weather-mcp", version: "1.0.0" });

server.tool(
  "get_weather_forecast",
  "Retrieves current conditions and a multi-day forecast (up to 7 days) for a named " +
    "location using the Open-Meteo weather service. Use this whenever the user asks about " +
    "current weather, an upcoming forecast, rain probability, or whether to plan indoor vs " +
    "outdoor activities for a specific destination.",
  {
    location: z
      .string()
      .describe('The place to get weather for, e.g. "Singapore".'),
    days: z
      .number()
      .int()
      .min(1)
      .max(7)
      .optional()
      .describe("How many days of forecast to return, including today (default 3, max 7)."),
  },
  async ({ location, days }) => {
    try {
      const place = await geocodeLocation(location);
      const forecast = await fetchForecast(place.latitude, place.longitude, days ?? 3);

      const dailyForecast = forecast.daily.time.map((date, i) => ({
        date,
        minTempC: forecast.daily.temperature_2m_min[i],
        maxTempC: forecast.daily.temperature_2m_max[i],
        precipitationProbabilityPercent: forecast.daily.precipitation_probability_max[i],
        conditions: describeWeatherCode(forecast.daily.weathercode[i]),
      }));

      const payload = {
        location: `${place.name}, ${place.country}`,
        currentConditions: forecast.current_weather
          ? {
              temperatureC: forecast.current_weather.temperature,
              conditions: describeWeatherCode(forecast.current_weather.weathercode),
              observedAt: forecast.current_weather.time,
            }
          : null,
        dailyForecast,
        provider: "Open-Meteo (open-meteo.com)",
        retrievedAt: new Date().toISOString(),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown weather tool error",
            }),
          },
        ],
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

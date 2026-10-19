/** Snippets for the "For developers" section. Package names match the planned public packages. */

export const sdkInstall = `npm install @seenit/sdk`;

export const sdkExample = `import { Seenit } from "@seenit/sdk";

const seenit = new Seenit({ apiKey: process.env.SEENIT_API_KEY });

// Post a paid mission and wait for a structured answer
const mission = await seenit.missions.create({
  title: "Is Luna Bakery open?",
  location: { lat: 37.7761, lng: -122.4237 },
  radiusMeters: 100,
  reward: "1.50",
  answer: { is_open: "boolean", sign_text: "string" },
});

const { answer } = await mission.result();`;

export const mcpConfig = `{
  "mcpServers": {
    "seenit": {
      "command": "npx",
      "args": ["-y", "@seenit/mcp"],
      "env": { "SEENIT_API_KEY": "sk_test_..." }
    }
  }
}`;

export const developerPoints = [
  "Works with any MCP-compatible agent",
  "TypeScript SDK and REST API",
  "Webhooks the moment an answer lands",
  "Test mode on Robinhood Chain testnet",
] as const;

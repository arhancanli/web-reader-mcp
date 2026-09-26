// Weekly canary (.github/workflows/canary.yml): real pages, fetched live with robots.txt checked.
// Asserts only facts that should not change (text of a published RFC).
import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../src/server.mjs";

const client = new Client({ name: "canary", version: "0" });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([buildServer().connect(a), client.connect(b)]);
await client.listTools();

test("live: an RFC read with a query, and a private address refused", { timeout: 90_000 }, async () => {
  const r = await client.callTool({ name: "read_page", arguments: { url: "https://www.rfc-editor.org/rfc/rfc9309.html", query: "parsing limit", max_chars: 1500 } });
  assert.match(r.structuredContent.content, /500 kibibytes/);
  const p = await client.callTool({ name: "read_page", arguments: { url: "http://169.254.169.254/latest/meta-data/" } });
  assert.equal(p.isError, true);
  await client.close();
});

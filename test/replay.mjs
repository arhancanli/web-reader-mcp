// Replays recorded pages (test/fixtures/pages.json.gz) for the golden tests: the reader's
// fetchPage is swapped for a lookup, robots.txt files included.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer, createContext } from "../src/server.mjs";

export const loadFixtures = () => JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/pages.json.gz", import.meta.url))).toString("utf8"));

export function replayFetch(fixtures = loadFixtures()) {
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    const hit = fixtures[url];
    if (!hit) throw new Error(`no fixture for ${url}`);
    return { url: hit.url, status: hit.status, headers: hit.headers, body: Buffer.from(hit.body, "base64") };
  };
  return { fetchPage, calls };
}

export async function connect(fetchPage = replayFetch().fetchPage, env = {}) {
  const server = buildServer(createContext({ fetchPage, env }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "golden", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  // Like a real client: once the tools are listed, every result is validated against its schema.
  await client.listTools();
  return client;
}

export async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  return { res, data: res.structuredContent ?? JSON.parse(res.content[0].text) };
}

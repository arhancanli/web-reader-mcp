#!/usr/bin/env node
// node test/record.mjs: re-records test/fixtures/pages.json.gz by running the scenarios live.
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { fetchUrl } from "../src/net.mjs";
import { buildServer, createContext } from "../src/server.mjs";
import { SCENARIOS } from "./scenarios.mjs";

const recorded = {};
const userAgent = createContext().userAgent;
const fetchPage = async (url, opts = {}) => {
  const r = await fetchUrl(url, { userAgent, ...opts });
  const headers = Object.fromEntries(["content-type", "cf-mitigated"].filter((k) => r.headers[k]).map((k) => [k, r.headers[k]]));
  recorded[url] = { url: r.url, status: r.status, headers, body: r.body.toString("base64") };
  return r;
};
const server = buildServer(createContext({ fetchPage }));
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "record", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);
for (const s of SCENARIOS) {
  const res = await client.callTool({ name: s.tool, arguments: s.args });
  if (Boolean(res.isError) !== Boolean(s.expectError)) console.error(`unexpected result for ${s.label}: ${res.content[0].text.slice(0, 200)}`);
}
const refused = Object.entries(recorded).filter(([, v]) => v.status === 429 || v.status >= 500);
if (refused.length) {
  console.error(`not written: ${refused.length} refused responses (${refused.map(([k, v]) => `${v.status} ${k}`).join("; ")}).`);
  process.exit(1);
}
const sorted = Object.fromEntries(Object.entries(recorded).sort(([x], [y]) => x.localeCompare(y)));
const gz = gzipSync(JSON.stringify(sorted), { level: 9 });
writeFileSync(new URL("./fixtures/pages.json.gz", import.meta.url), gz);
console.log(`recorded ${Object.keys(sorted).length} responses, ${gz.length} bytes compressed`);

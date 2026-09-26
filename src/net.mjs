// src/net.mjs
//
// Fetching any public URL safely. A reader must reach arbitrary sites, so instead of a host
// allowlist it refuses addresses that are not public: loopback, private networks, link-local
// (including cloud metadata at 169.254.169.254), carrier NAT, multicast, reserved and documentation
// ranges, for IPv4 and IPv6. The check runs inside the socket's DNS lookup, so it applies to the
// address actually connected to (a name that re-resolves to a private address mid-request is
// refused too), and again on every redirect. Bodies are capped after decompression.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import zlib from "node:zlib";
import { ToolError } from "./kit/index.mjs";

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const v4 = (ip) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
const inV4 = (ip, [net, bits]) => bits === 0 || Math.floor(v4(ip) / 2 ** (32 - bits)) === Math.floor(v4(net) / 2 ** (32 - bits));

/** Whether an address is on the public internet. */
export function isPublicAddress(ip) {
  const kind = isIP(ip);
  if (kind === 4) return !V4_BLOCKED.some((r) => inV4(ip, r));
  if (kind !== 6) return false;
  const a = ip.toLowerCase();
  const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? a.match(/^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  if (a === "::" || a === "::1") return false;
  const first = parseInt(a.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (a.startsWith("2001:db8:") || a.startsWith("2001:0db8:")) return false; // documentation
  return (first & 0xe000) === 0x2000; // global unicast is 2000::/3
}

/** A DNS lookup for sockets that refuses non-public answers (unless allowed). */
function guardedLookup(allowPrivate) {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true, family: options?.family ?? 0 }, (err, addresses) => {
      if (err) return callback(err);
      const bad = allowPrivate ? undefined : addresses.find((x) => !isPublicAddress(x.address));
      if (bad) return callback(Object.assign(new Error(`${hostname} resolves to ${bad.address}`), { code: "EPRIVATE" }));
      if (options?.all) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

const MAX_REDIRECTS = 5;

function once(url, { headers, timeoutMs, maxBytes, allowPrivate, agentFor }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, { method: "GET", headers, lookup: guardedLookup(allowPrivate), agent: agentFor(url.protocol), timeout: timeoutMs }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, location: res.headers.location, headers: res.headers });
      }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
      const chunks = [];
      let size = 0;
      stream.on("data", (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          stream.destroy();
          reject(new ToolError("too_large", `${url.hostname} sent more than ${Math.round(maxBytes / 1e6)} MB; the page is too large to read.`));
        } else chunks.push(c);
      });
      stream.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks) }));
      stream.on("error", () => reject(new ToolError("bad_encoding", `${url.hostname} sent a body that does not decompress.`)));
    });
    req.on("timeout", () => req.destroy(new ToolError("upstream_timeout", `${url.hostname} did not answer within ${timeoutMs / 1000} s.`)));
    req.on("error", (err) => {
      if (err instanceof ToolError) return reject(err);
      if (err.code === "EPRIVATE") return reject(new ToolError("private_address", `${url.hostname} points to a private or reserved address (${err.message.split(" ").pop()}). This server reads public sites only; set WEB_READER_ALLOW_PRIVATE=1 to read local ones.`));
      if (err.code === "ENOTFOUND") return reject(new ToolError("no_such_host", `${url.hostname} does not exist (DNS has no address for it).`));
      reject(new ToolError("upstream_unreachable", `${url.hostname} could not be reached (${err.code ?? err.message}).`));
    });
    req.end();
  });
}

/**
 * GET a public URL, following up to 5 redirects (each re-checked).
 * @returns {Promise<{url: string, status: number, headers: object, body: Buffer}>}
 */
export async function fetchUrl(raw, { userAgent, timeoutMs = 20_000, maxBytes = 15_000_000, allowPrivate = false, accept } = {}) {
  let url = parseUrl(raw);
  const agents = { "http:": new http.Agent({ keepAlive: false }), "https:": new https.Agent({ keepAlive: false }) };
  const headers = { "User-Agent": userAgent, Accept: accept ?? "text/html,application/xhtml+xml,application/pdf;q=0.9,text/plain;q=0.8,*/*;q=0.5", "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en;q=1, *;q=0.5" };
  for (let hop = 0; ; hop++) {
    if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !allowPrivate && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
      throw new ToolError("private_address", `${url.hostname} is a private or reserved address. This server reads public sites only; set WEB_READER_ALLOW_PRIVATE=1 to read local ones.`);
    }
    const r = await once(url, { headers, timeoutMs, maxBytes, allowPrivate, agentFor: (p) => agents[p] });
    if (r.location) {
      if (hop >= MAX_REDIRECTS) throw new ToolError("too_many_redirects", `${raw} redirects more than ${MAX_REDIRECTS} times.`);
      url = parseUrl(new URL(r.location, url).href);
      continue;
    }
    return { url: url.href, status: r.status, headers: r.headers, body: r.body };
  }
}

/** An http(s) URL, or a clear error. Bare domains get https. */
export function parseUrl(raw) {
  const text = String(raw ?? "").trim();
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw new ToolError("bad_url", `"${text}" is not a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ToolError("bad_url", `Only http and https URLs can be read, not ${url.protocol}`);
  if (url.username || url.password) throw new ToolError("bad_url", "URLs with credentials are not read.");
  url.hash = "";
  return url;
}

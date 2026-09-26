// src/document.mjs
//
// One URL, loaded once: robots.txt checked, the page fetched, its type recognised (HTML, PDF,
// JSON, plain text or Markdown), converted, and kept for 10 minutes so an outline, a search and a
// section read cost one download. Refusals by the site are reported as what they are; this reader
// does not disguise itself or get around bot protection.
import { ToolError } from "./kit/index.mjs";
import { fromHtml, fromPdf, sectionsOf } from "./extract.mjs";
import { parseUrl } from "./net.mjs";
import { checkRobots } from "./robots.mjs";

const TTL_MS = 10 * 60_000;
const MAX_DOCS = 40;
const MAX_JSON_CHARS = 400_000;

function kindOf(contentType, body, url) {
  const ct = String(contentType ?? "").toLowerCase();
  const head = body.subarray(0, 512).toString("latin1").trimStart();
  if (ct.includes("pdf") || head.startsWith("%PDF-")) return "pdf";
  if (ct.includes("html") || ct.includes("xhtml") || /^<(!doctype html|html|head|body)/i.test(head)) return "html";
  if (ct.includes("json")) return "json";
  if (ct.includes("markdown") || /\.md$/i.test(new URL(url).pathname)) return "markdown";
  if (ct.startsWith("text/") || ct.includes("xml")) return "text";
  return null;
}

/** @returns {Promise<{url: string, title?: string, markdown: string, sections: object[], links: object[], extracted: string}>} */
export async function loadDocument(ctx, raw) {
  const asked = parseUrl(raw).href;
  ctx.docs ??= new Map();
  const hit = ctx.docs.get(asked);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.doc;
  if (!ctx.ignoreRobots) {
    const r = await checkRobots(ctx, asked);
    if (!r.ok) throw new ToolError("robots_disallowed", `${new URL(asked).host} asks automated readers not to fetch this page (${r.reason ?? `robots.txt: Disallow ${r.rule}`}). Set WEB_READER_IGNORE_ROBOTS=1 to read it anyway on your own responsibility.`);
  }
  const res = await ctx.fetchPage(asked);
  const host = new URL(res.url).host;
  if (res.status === 401 || res.status === 403 || res.status === 429 || res.status === 503) {
    const challenge = res.headers["cf-mitigated"] === "challenge" || /captcha|challenge|are you a robot|access denied/i.test(res.body.subarray(0, 4000).toString("utf8"));
    throw new ToolError("blocked", `${host} refused the request (${res.status})${challenge ? ": a bot-protection challenge. This reader does not get around those; open the page in a browser" : res.status === 429 ? ": too many requests; try later" : ""}.`, { status: res.status });
  }
  if (res.status === 404 || res.status === 410) throw new ToolError("not_found", `${res.url} does not exist (${res.status}).`);
  if (res.status >= 400) throw new ToolError("upstream_status", `${host} answered ${res.status}.`, { status: res.status });
  const kind = kindOf(res.headers["content-type"], res.body, res.url);
  let doc;
  if (kind === "html") doc = fromHtml(res.body, res.url, res.headers["content-type"]);
  else if (kind === "pdf") doc = await fromPdf(res.body);
  else if (kind === "json") {
    let text = res.body.toString("utf8");
    try {
      text = JSON.stringify(JSON.parse(text), null, 1);
    } catch {
      // not valid JSON after all: shown as sent
    }
    doc = { markdown: `\`\`\`json\n${text.slice(0, MAX_JSON_CHARS)}\n\`\`\``, links: [], extracted: "json" };
  } else if (kind === "markdown" || kind === "text") doc = { markdown: res.body.toString("utf8").replace(/\r\n/g, "\n"), links: [], extracted: kind };
  else throw new ToolError("unsupported_type", `${res.url} is ${res.headers["content-type"] ?? "an unknown type"}, not a page or document this reader can turn into text.`);
  doc.url = res.url;
  doc.sections = sectionsOf(doc.markdown);
  if (!doc.markdown.trim()) throw new ToolError("empty", `${res.url} has no readable text (it may be built by JavaScript in the browser).`);
  ctx.docs.set(asked, { at: Date.now(), doc });
  while (ctx.docs.size > MAX_DOCS) ctx.docs.delete(ctx.docs.keys().next().value);
  return doc;
}

/** The outline line for a section: "s3 ## Title (1,240 chars)". */
export const outlineLine = (s) => `${s.id} ${"#".repeat(Math.max(1, s.level))} ${s.title} (${(s.end - s.start).toLocaleString("en-US")} chars)`;

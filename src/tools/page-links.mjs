import { z } from "zod";
import { compact, defineTool } from "../kit/index.mjs";
import { loadDocument } from "../document.mjs";
import { head, READ_ONLY, urlInput } from "./shared.mjs";

export const pageLinks = defineTool({
  name: "page_links",
  title: "Links on a page",
  description: "The links on a page (text and absolute URL, tracking parameters removed, duplicates dropped), optionally only those containing a word in text or URL, or only same-site ones. For crawling docs or finding a download.",
  input: { url: urlInput, contains: z.string().max(100).optional(), same_site: z.boolean().optional(), limit: z.number().int().min(1).max(300).optional().describe("default 100") },
  output: { url: z.string(), total: z.number(), links: z.array(z.string()) },
  annotations: READ_ONLY,
  handler: async ({ url, contains, same_site: same, limit = 100 }, ctx) => {
    const doc = await loadDocument(ctx, url);
    const host = new URL(doc.url).hostname.replace(/^www\./, "");
    const want = contains?.toLowerCase();
    const rows = doc.links.filter((l) => (!want || `${l.text} ${l.url}`.toLowerCase().includes(want)) && (!same || new URL(l.url).hostname.replace(/^www\./, "") === host));
    return { ...compact({ ...head(doc), more: rows.length > limit ? rows.length - limit : undefined }), url: doc.url, total: rows.length, links: rows.slice(0, limit).map((l) => (l.text && l.text !== l.url ? `${l.text} | ${l.url}` : l.url)) };
  },
});

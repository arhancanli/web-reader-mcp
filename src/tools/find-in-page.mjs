import { z } from "zod";
import { compact, defineTool, ToolError } from "../kit/index.mjs";
import { loadDocument } from "../document.mjs";
import { head, READ_ONLY, urlInput } from "./shared.mjs";

const MAX_MATCHES = 20;

export const findInPage = defineTool({
  name: "find_in_page",
  title: "Search a page for text",
  description: "Finds exact text (case-insensitive) or a regular expression in a page or PDF and returns each match with surrounding context and its section id. For facts whose wording you know: a name, a number, an error message.",
  input: { url: urlInput, text: z.string().max(200), regex: z.boolean().optional(), context: z.number().int().min(20).max(1000).optional().describe("chars around each match, default 200") },
  output: { url: z.string(), total: z.number(), matches: z.array(z.looseObject({ section: z.string() })) },
  annotations: READ_ONLY,
  handler: async ({ url, text, regex, context = 200 }, ctx) => {
    const doc = await loadDocument(ctx, url);
    let re;
    try {
      re = new RegExp(regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    } catch {
      throw new ToolError("bad_regex", `"${text}" is not a valid regular expression.`);
    }
    const md = doc.markdown;
    const matches = [];
    let total = 0;
    let lastEnd = -1;
    for (const m of md.matchAll(re)) {
      if (!m[0]) break;
      total++;
      if (matches.length >= MAX_MATCHES || m.index < lastEnd) continue;
      const a = Math.max(0, m.index - context);
      const b = Math.min(md.length, m.index + m[0].length + context);
      lastEnd = b;
      const section = [...doc.sections].reverse().find((s) => s.start <= m.index);
      matches.push({ section: section ? `${section.id} ${section.title}` : "s0", at: m.index, text: `${a > 0 ? "..." : ""}${md.slice(a, b).replace(/\s+/g, " ").trim()}${b < md.length ? "..." : ""}` });
    }
    return { ...compact({ ...head(doc), note: total > matches.length ? `${total - matches.length} more matches (overlapping or past the first ${MAX_MATCHES}).` : undefined }), url: doc.url, total, matches };
  },
});

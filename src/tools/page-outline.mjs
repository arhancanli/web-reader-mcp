import { z } from "zod";
import { compact, defineTool } from "../kit/index.mjs";
import { loadDocument, outlineLine } from "../document.mjs";
import { head, READ_ONLY, urlInput } from "./shared.mjs";

const MAX_LINES = 200;

export const pageOutline = defineTool({
  name: "page_outline",
  title: "Outline of a page",
  description: "The headings of a page or PDF with section ids and sizes, plus title, site, date and length, to read one part with read_page section instead of the whole page.",
  input: { url: urlInput, depth: z.number().int().min(1).max(6).optional().describe("deepest heading level, default all") },
  output: { url: z.string(), chars: z.number(), sections: z.array(z.string()) },
  annotations: READ_ONLY,
  handler: async ({ url, depth }, ctx) => {
    const doc = await loadDocument(ctx, url);
    const all = doc.sections.filter((s) => !depth || s.level <= depth);
    return {
      ...compact({ ...head(doc), description: doc.description, lang: doc.lang, extracted: doc.extracted === "page" ? "whole page (no single article found)" : undefined, more: all.length > MAX_LINES ? all.length - MAX_LINES : undefined }),
      url: doc.url,
      chars: doc.markdown.length,
      sections: all.slice(0, MAX_LINES).map(outlineLine),
    };
  },
});

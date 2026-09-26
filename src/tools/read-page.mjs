import { z } from "zod";
import { compact, defineTool, ToolError } from "../kit/index.mjs";
import { loadDocument, outlineLine } from "../document.mjs";
import { bestPassages } from "../passages.mjs";
import { head, READ_ONLY, urlInput } from "./shared.mjs";

const DEFAULT_CHARS = 8000;
const OUTLINE_LINES = 40;

/** Cut at a paragraph or line break near the limit, not mid-word. */
function cut(text, start, max) {
  if (start + max >= text.length) return { text: text.slice(start), next: undefined };
  const slice = text.slice(start, start + max);
  const at = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"));
  const end = at > max * 0.6 ? at : max;
  return { text: slice.slice(0, end).trimEnd(), next: start + end };
}

export const readPage = defineTool({
  name: "read_page",
  title: "Read a web page or PDF",
  description: "Reads a URL as clean Markdown (main content only). With query: only the passages that answer it, from anywhere in the page. With section (from the outline): that section. Otherwise from start; long pages give an outline and next_start.",
  input: {
    url: urlInput,
    query: z.string().max(300).optional().describe("what you need from the page"),
    section: z.string().max(8).optional().describe("section id, e.g. s4"),
    start: z.number().int().min(0).optional(),
    max_chars: z.number().int().min(500).max(50000).optional().describe("default 8000"),
  },
  output: { url: z.string(), chars: z.number(), content: z.string() },
  annotations: READ_ONLY,
  handler: async ({ url, query, section, start = 0, max_chars: max = DEFAULT_CHARS }, ctx) => {
    const doc = await loadDocument(ctx, url);
    const total = doc.markdown.length;
    if (query) {
      const best = bestPassages(doc.markdown, query, max);
      if (!best.shown) {
        return { ...compact({ ...head(doc), note: `No passage matches "${query}". Read the outline (page_outline) or search exact text (find_in_page).` }), url: doc.url, chars: total, content: "" };
      }
      return { ...compact({ ...head(doc), passages: `${best.shown} of ${best.matched} matching` }), url: doc.url, chars: total, content: best.text };
    }
    let body = doc.markdown;
    let from = start;
    let label;
    if (section) {
      const s = doc.sections.find((x) => x.id === section.trim().toLowerCase());
      if (!s) throw new ToolError("no_section", `${doc.url} has no section ${section}; sections run s0 to ${doc.sections.at(-1).id} (see page_outline).`);
      // A section runs to the next heading of the same or a higher level.
      const endAt = doc.sections.find((x) => x.start > s.start && x.level <= s.level && x.level > 0)?.start ?? total;
      body = doc.markdown.slice(s.start, endAt);
      label = s.title;
    }
    if (from >= body.length && body.length) throw new ToolError("past_end", `start ${from} is past the end (${body.length} chars).`);
    const piece = cut(body, from, max);
    const truncated = piece.next !== undefined;
    return {
      ...compact({
        ...head(doc),
        section: label,
        start: from || undefined,
        next_start: piece.next,
        outline: truncated && !section && from === 0 ? doc.sections.slice(0, OUTLINE_LINES).map(outlineLine) : undefined,
        note: truncated && !section && from === 0 ? `Long page (${total.toLocaleString("en-US")} chars). Use query to get only what you need, or section to read one part.${doc.sections.length > OUTLINE_LINES ? ` Outline shows ${OUTLINE_LINES} of ${doc.sections.length} sections.` : ""}` : undefined,
      }),
      url: doc.url,
      chars: body.length,
      content: piece.text,
    };
  },
});

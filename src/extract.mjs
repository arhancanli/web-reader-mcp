// src/extract.mjs
//
// From bytes to a readable document: the main content (Mozilla Readability, as in Firefox's Reader
// View) as Markdown (Turndown, with GitHub tables), split into sections by heading. Images and
// citation markers are dropped, links are made absolute and stripped of tracking parameters, so
// the Markdown carries text, not page furniture. PDFs become text page by page.
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { ToolError } from "./kit/index.mjs";

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_[a-z]+|ref_src|igshid|_hs[a-z]+)$/i;
// Not <form>: some sites (ASP.NET) wrap the whole page in one.
const NOISE = "script, style, noscript, template, iframe, svg, canvas, button, nav, footer, [role=navigation], [aria-hidden=true], sup.reference, .mw-editsection, .navbox, .metadata, .noprint";

/** An absolute link without tracking parameters; undefined for in-page anchors and scripts. */
export function cleanLink(href, base) {
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) return href?.startsWith("mailto:") ? href : undefined;
  try {
    const u = new URL(href, base);
    if (u.href.split("#")[0] === String(base).split("#")[0]) return undefined;
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return undefined;
  }
}

function markdownFor(html, base) {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_" });
  td.use(gfm);
  // Markdown escapes ("1\\.", "\\[KiB\\]") are noise to a model reading text; keep characters as written.
  td.escape = (s) => s;
  td.remove(["script", "style", "noscript", "iframe"]);
  td.addRule("images", { filter: ["img", "picture", "figure > img"], replacement: () => "" });
  td.addRule("links", {
    filter: (node) => node.nodeName === "A",
    replacement: (content, node) => {
      const text = content.replace(/\s+/g, " ").trim();
      const href = cleanLink(node.getAttribute("href"), base);
      if (!text) return "";
      if (!href) return text;
      return text === href ? `<${href}>` : `[${text}](${href})`;
    },
  });
  return td
    .turndown(html)
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]*\u00b6/g, "") // heading permalinks (RFCs, Sphinx docs)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function charsetOf(contentType, head) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const cs = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    new TextDecoder(cs);
    return cs;
  } catch {
    return "utf-8";
  }
}

const meta = (doc, ...names) => {
  for (const n of names) {
    const v = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`)?.getAttribute("content");
    if (v?.trim()) return v.replace(/\s+/g, " ").trim();
  }
  return undefined;
};

/**
 * API documentation (Sphinx, and generators like it) marks each function, class or option with a
 * definition term. Those become headings, so the outline, passages and search results name the
 * function a line belongs to. Only signatures qualify (Sphinx's dt.sig, or a term that reads like
 * "name(args)" or "class Name"), not reference lists or glossaries.
 */
const SIGNATURE = /^(@?[\w.]+\s*\(.*\)|class\s+[\w.]+|@[\w.]+)/;
export function definitionsAsHeadings(document) {
  for (const dt of document.querySelectorAll("dl > dt[id]")) {
    const text = (dt.textContent ?? "").replace(/[\u00b6#]\s*$/, "").replace(/\s+/g, " ").trim();
    if (!text || !(dt.classList?.contains("sig") || SIGNATURE.test(text))) continue;
    const h = document.createElement("h4");
    h.textContent = text;
    dt.replaceWith(h);
  }
}

/** An HTML page: metadata, every link, and the main content as Markdown. */
export function fromHtml(body, url, contentType) {
  const html = new TextDecoder(charsetOf(contentType, body.subarray(0, 2048).toString("latin1"))).decode(body);
  const { document } = parseHTML(html);
  const links = [];
  const seen = new Set();
  for (const a of document.querySelectorAll("a[href]")) {
    const href = cleanLink(a.getAttribute("href"), url);
    const text = (a.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!href || href.startsWith("mailto:") || seen.has(href)) continue;
    seen.add(href);
    links.push({ text: text.slice(0, 120), url: href });
  }
  const info = {
    title: meta(document, "og:title") ?? document.title?.trim() ?? undefined,
    site: meta(document, "og:site_name"),
    description: meta(document, "description", "og:description"),
    published: meta(document, "article:published_time", "datePublished", "date"),
    lang: document.documentElement?.getAttribute("lang") ?? undefined,
    canonical: cleanLink(document.querySelector('link[rel="canonical"]')?.getAttribute("href"), url),
  };
  // Readability changes the tree it reads, so it gets its own parse, cleaned of page furniture.
  const { document: forReader } = parseHTML(html);
  forReader.querySelectorAll(NOISE).forEach((n) => n.remove());
  definitionsAsHeadings(forReader);
  let article = null;
  try {
    article = new Readability(forReader, { charThreshold: 300 }).parse();
  } catch {
    article = null;
  }
  let content = article?.content;
  let extracted = "main";
  if (!content || (article.length ?? 0) < 400) {
    // Not an article (a docs index, a listing): the body without furniture.
    const { document: whole } = parseHTML(html);
    whole.querySelectorAll(`${NOISE}, header, aside`).forEach((n) => n.remove());
    definitionsAsHeadings(whole);
    content = whole.body?.innerHTML ?? "";
    extracted = "page";
  }
  const markdown = markdownFor(content, url);
  return { ...info, title: info.title ?? article?.title, byline: article?.byline ?? undefined, published: info.published ?? article?.publishedTime ?? undefined, markdown, links, extracted };
}

/** A PDF: its text, page by page, under "## Page N" headings. */
export async function fromPdf(body) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(body));
  } catch {
    throw new ToolError("bad_pdf", "The PDF could not be opened (damaged or encrypted).");
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  let title;
  try {
    title = (await pdf.getMetadata())?.info?.Title?.trim() || undefined;
  } catch {
    title = undefined;
  }
  const markdown = text.map((t, i) => `## Page ${i + 1}\n\n${t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()}`).join("\n\n");
  if (!markdown.replace(/## Page \d+/g, "").trim()) throw new ToolError("no_text", `The PDF has ${totalPages} pages but no text layer (a scan); it would need OCR.`);
  return { title, pages: totalPages, markdown, links: [], extracted: "pdf" };
}

/** Sections by heading, outside code fences: [{id, level, title, start, end}]. s0 is text before the first heading. */
export function sectionsOf(markdown) {
  const sections = [];
  let fence = false;
  let offset = 0;
  const push = (level, title, start) => {
    if (sections.length) sections.at(-1).end = start;
    sections.push({ id: `s${sections.length}`, level, title, start, end: markdown.length });
  };
  push(0, "(top)", 0);
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) push(h[1].length, h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim(), offset);
    offset += line.length + 1;
  }
  return sections.filter((s) => s.id === "s0" ? s.end > 0 && markdown.slice(0, s.end).trim() : true);
}

// src/passages.mjs
//
// The parts of a long page that answer a query: the Markdown is cut into passages of a few hundred
// characters (never inside a code block), each knowing its heading path, ranked by BM25, and the
// best returned in page order within a character budget. A 350,000-character manual answers a
// question in a few thousand characters.

const STOP = new Set("a an and are as at be but by for from has have how i if in into is it its of on or that the their then there these this to was what when where which who why will with you your does do can".split(" "));
const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));

/** Passages with their heading path and position. */
export function passagesOf(markdown, target = 700) {
  const out = [];
  const path = [];
  let buf = [];
  let bufStart = 0;
  let offset = 0;
  let fence = false;
  const flush = () => {
    const text = buf.join("\n").trim();
    if (text) out.push({ text, start: bufStart, path: path.map((p) => p.title).join(" > ") });
    buf = [];
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      flush();
      const level = h[1].length;
      while (path.length && path.at(-1).level >= level) path.pop();
      path.push({ level, title: h[2].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim() });
      bufStart = offset + line.length + 1;
    } else {
      if (!buf.length) bufStart = offset;
      buf.push(line);
      // Close a passage at a blank line once it is long enough, or at a sentence end once it is
      // well past it (PDF text has no blank lines), never inside a code block.
      const size = buf.join("\n").length;
      if (!fence && ((line.trim() === "" && size >= target) || (size >= target * 1.6 && /[.!?:]\s*$/.test(line)))) flush();
    }
    offset += line.length + 1;
  }
  flush();
  return out;
}

/**
 * The passages that best answer a query, in page order, within max characters.
 * @returns {{text: string, matched: number, shown: number}}
 */
export function bestPassages(markdown, query, maxChars) {
  const passages = passagesOf(markdown);
  const q = [...new Set(words(query))];
  if (!q.length || !passages.length) return { text: "", matched: 0, shown: 0 };
  const docs = passages.map((p) => words(`${p.path} ${p.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = Object.fromEntries(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  const phrase = query.trim().toLowerCase();
  const compounds = [...new Set((phrase.match(/[\p{L}\p{N}]+(?:[-_.][\p{L}\p{N}]+)+/gu) ?? []).concat([...phrase.matchAll(/"([^"]+)"/g)].map((m) => m[1])))];
  const scored = passages.map((p, i) => {
    const d = docs[i];
    let score = 0;
    for (const t of q) {
      const tf = d.filter((w) => w === t).length;
      if (!tf) continue;
      const idf = Math.log(1 + (passages.length - df[t] + 0.5) / (df[t] + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / avg)));
    }
    // A heading names what its section is about: query words there count again.
    const inPath = words(p.path);
    for (const t of q) if (inPath.includes(t)) score += 1.5;
    // The exact wording, compound terms ("content-location", "lru_cache") and all the query's
    // words together count for more than scattered hits.
    const lower = `${p.path}\n${p.text}`.toLowerCase();
    if (phrase.length > 3 && lower.includes(phrase)) score *= 1.5;
    for (const c of compounds) if (lower.includes(c)) score *= 1.6;
    if (q.every((t) => d.includes(t))) score *= 1.3;
    // The section whose own heading is the queried term ("8.7. Content-Location") is its definition.
    const ownHeading = p.path.split(" > ").at(-1)?.toLowerCase() ?? "";
    if (compounds.some((c) => ownHeading.includes(c)) || (phrase.length > 3 && ownHeading.includes(phrase))) score *= 2;
    return { ...p, i, score };
  });
  const ranked = scored.filter((p) => p.score > 0).sort((a, b) => b.score - a.score);
  const chosen = [];
  let used = 0;
  for (const p of ranked) {
    const cost = p.text.length + p.path.length + 12;
    if (used + cost > maxChars && chosen.length) continue;
    chosen.push(p);
    used += cost;
    if (used >= maxChars) break;
  }
  chosen.sort((a, b) => a.i - b.i);
  const blocks = [];
  let lastPath;
  let lastI = -2;
  for (const p of chosen) {
    if (p.i !== lastI + 1) blocks.push("[...]");
    if (p.path && p.path !== lastPath) blocks.push(`### ${p.path}`);
    blocks.push(p.text.length > maxChars ? `${p.text.slice(0, maxChars)} [...]` : p.text);
    lastPath = p.path;
    lastI = p.i;
  }
  return { text: blocks.join("\n\n"), matched: ranked.length, shown: chosen.length };
}

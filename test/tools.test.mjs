// Golden tests: every tool over a real MCP client, replaying pages recorded by test/record.mjs
// (robots.txt files included). No test here touches the network.
import assert from "node:assert/strict";
import test from "node:test";
import { call, connect, replayFetch } from "./replay.mjs";
import { AUSTEN, FUNCTOOLS, RFC9110, RFC9309, RFC9309_PDF } from "./scenarios.mjs";

test("read_page with a query: the defining section of a 435,000-character RFC, within the budget", async () => {
  const client = await connect();
  const { data } = await call(client, "read_page", { url: RFC9110, query: "Content-Location header field", max_chars: 2000 });
  assert.equal(data.title, "RFC 9110: HTTP Semantics");
  assert.ok(data.chars > 400_000);
  assert.ok(data.content.length <= 2100, "the budget holds");
  assert.match(data.content.split("\n").find((l) => l.startsWith("### ")), /8\.7\. Content-Location$/, "the section named by the query comes first");
  assert.match(data.content, /header field references a URI/);
  const none = await call(client, "read_page", { url: RFC9110, query: "zzzqqq xylophone" });
  assert.deepEqual([none.data.content, /No passage matches/.test(none.data.note)], ["", true]);
});

test("read_page without a query: the start, an outline and next_start; a section on its own; paging", async () => {
  const client = await connect();
  const first = await call(client, "read_page", { url: RFC9309 });
  assert.ok(first.data.next_start > 5000 && first.data.next_start <= 8000);
  assert.ok(first.data.outline.some((l) => /^s\d+ ### 2\.5\. Limits \(/.test(l)));
  assert.match(first.data.note, /Long page/);
  assert.ok(!first.data.content.includes("¶") && !first.data.content.includes("\\["), "no permalink marks or Markdown escapes");
  const next = await call(client, "read_page", { url: RFC9309, start: first.data.next_start });
  assert.ok(next.data.content.length > 0 && next.data.outline === undefined);
  const limitsId = first.data.outline.find((l) => l.includes("2.5. Limits")).split(" ")[0];
  const sec = await call(client, "read_page", { url: RFC9309, section: limitsId });
  assert.equal(sec.data.section, "2.5. Limits");
  assert.match(sec.data.content, /MUST be at least 500 kibibytes/);
  const bad = await call(client, "read_page", { url: RFC9309, section: "s999" });
  assert.equal(bad.data.error.code, "no_section");
});

test("page_outline, find_in_page and page_links read the same cached download", async () => {
  const replay = replayFetch();
  const client = await connect(replay.fetchPage);
  const outline = await call(client, "page_outline", { url: RFC9309, depth: 2 });
  assert.ok(outline.data.sections.every((l) => !/ #{3,} /.test(l)), "depth 2 keeps ## and #");
  await call(client, "find_in_page", { url: RFC9309, text: "kibibytes" });
  assert.equal(replay.calls.filter((u) => u === RFC9309).length, 1, "one download for both calls");
  const austen = await call(client, "find_in_page", { url: AUSTEN, text: "pemberley", context: 40 });
  assert.equal(austen.data.total, 55, "every occurrence counted, matching the plain-text edition");
  assert.equal(austen.data.matches.length, 20);
  assert.match(austen.data.matches[0].text, /Pemberley/);
  const re = await call(client, "find_in_page", { url: RFC9309, text: "\\d{3} kibibytes", regex: true });
  assert.equal(re.data.total, 1);
  const links = await call(client, "page_links", { url: FUNCTOOLS, contains: "itertools" });
  assert.ok(links.data.links[0].endsWith("| https://docs.python.org/3.12/library/itertools.html"));
});

test("PDFs are read page by page; robots.txt refusals are errors that say how to override", async () => {
  const client = await connect();
  const pdf = await call(client, "read_page", { url: RFC9309_PDF, query: "parsing limit kibibytes", max_chars: 1200 });
  assert.equal(pdf.data.pages, 12);
  assert.match(pdf.data.content, /### Page \d+/);
  assert.match(pdf.data.content, /500 kibibytes/);
  const robots = await call(client, "read_page", { url: "https://nodejs.org/docs/v20.11.0/api/fs.html" });
  assert.equal(robots.data.error.code, "robots_disallowed");
  assert.match(robots.data.error.message, /Disallow \/docs\/.*WEB_READER_IGNORE_ROBOTS=1/);
});

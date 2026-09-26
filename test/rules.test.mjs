// The rules without the MCP layer: which addresses are public, the fetcher's refusals (against a
// local server), robots.txt per RFC 9309, links, sections and passages.
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { parseHTML } from "linkedom";
import { cleanLink, definitionsAsHeadings, sectionsOf } from "../src/extract.mjs";
import { fetchUrl, isPublicAddress, parseUrl } from "../src/net.mjs";
import { bestPassages, passagesOf } from "../src/passages.mjs";
import { allowed, rulesFor } from "../src/robots.mjs";

test("public addresses: private, loopback, link-local, metadata, CGNAT, mapped and documentation ranges refused", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) assert.ok(isPublicAddress(ip), ip);
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.5.4", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.10", "198.18.0.1", "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "not-an-ip"]) assert.ok(!isPublicAddress(ip), ip);
  assert.ok(isPublicAddress("172.32.0.1"), "just outside 172.16/12");
});

test("URLs: bare domains get https; other schemes and credentials are refused; fragments dropped", () => {
  assert.equal(parseUrl("example.com/a#b").href, "https://example.com/a");
  assert.throws(() => parseUrl("file:///etc/passwd"), { code: "bad_url" });
  assert.throws(() => parseUrl("ftp://example.com"), { code: "bad_url" });
  assert.throws(() => parseUrl("https://user:pw@example.com"), { code: "bad_url" });
});

test("fetching: private addresses refused (directly, by name and by redirect); redirects, gzip and the size cap", async () => {
  const server = http.createServer((req, res) => {
    if (req.url === "/gz") {
      res.writeHead(200, { "content-type": "text/plain", "content-encoding": "gzip" });
      return res.end(gzipSync("compressed hello"));
    }
    if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      return res.end();
    }
    if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("x".repeat(3000));
    }
    if (req.url === "/to-meta") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(fetchUrl(`${base}/`, { userAgent: "t" }), { code: "private_address" });
    await assert.rejects(fetchUrl(`http://localhost:${server.address().port}/`, { userAgent: "t" }), { code: "private_address" }, "a name that resolves to loopback");
    const ok = await fetchUrl(`${base}/`, { userAgent: "t", allowPrivate: true });
    assert.equal(ok.body.toString(), "hello");
    assert.equal((await fetchUrl(`${base}/gz`, { userAgent: "t", allowPrivate: true })).body.toString(), "compressed hello");
    await assert.rejects(fetchUrl(`${base}/loop`, { userAgent: "t", allowPrivate: true }), { code: "too_many_redirects" });
    await assert.rejects(fetchUrl(`${base}/big`, { userAgent: "t", allowPrivate: true, maxBytes: 1000 }), { code: "too_large" });
  } finally {
    server.close();
  }
});

test("robots.txt: the named group over *, longest match, Allow wins ties, wildcards and $", () => {
  const txt = "User-agent: *\nDisallow: /private/\nAllow: /private/open$\n\nUser-agent: Web-Reader-MCP\nUser-agent: other\nDisallow: /secret\nAllow: /secret/ok\nDisallow: /*.pdf$\n";
  const mine = rulesFor(txt);
  assert.deepEqual(mine.map((r) => r.path), ["/secret", "/secret/ok", "/*.pdf$"], "our group, not *");
  assert.equal(allowed(mine, "/private/x").ok, true, "the * group does not apply once a group names us");
  assert.equal(allowed(mine, "/secret/x").ok, false);
  assert.equal(allowed(mine, "/secret/ok/1").ok, true, "the longer rule wins");
  assert.equal(allowed(mine, "/a/b.pdf").ok, false);
  assert.equal(allowed(mine, "/a/b.pdf?x=1").ok, true, "$ anchors the end");
  const star = rulesFor(txt, "somebot");
  assert.equal(allowed(star, "/private/open").ok, true);
  assert.equal(allowed(star, "/private/openx").ok, false);
  assert.equal(allowed(rulesFor("User-agent: *\nAllow: /p\nDisallow: /p\n"), "/p").ok, true, "Allow wins a tie");
  assert.equal(allowed(rulesFor("User-agent: *\nDisallow:\n"), "/anything").ok, true, "an empty Disallow allows everything");
});

test("links, sections and passages: absolute, untracked links; headings outside code; passages never split code", () => {
  assert.equal(cleanLink("/a?utm_source=x&id=2#top", "https://ex.com/p"), "https://ex.com/a?id=2#top", "fragments kept: they point at a definition");
  assert.equal(cleanLink("#section", "https://ex.com/p"), undefined);
  assert.equal(cleanLink("javascript:void(0)", "https://ex.com/p"), undefined);
  const md = "intro\n\n# Title\n\ntext\n\n```\n# not a heading\n```\n\n## Sub\n\nmore";
  const secs = sectionsOf(md);
  assert.deepEqual(secs.map((s) => s.title), ["(top)", "Title", "Sub"]);
  const code = "## Code\n\n```js\n" + "const a = 1;\n\n".repeat(200) + "```\n\nafter";
  const ps = passagesOf(code);
  assert.ok(ps.every((p) => (p.text.match(/```/g) ?? []).length % 2 === 0), "a code block stays in one passage");
  const doc = Array.from({ length: 60 }, (_, i) => `## Part ${i}\n\n${i === 42 ? "The frobnicator limit is 17 widgets." : "Filler text about other things entirely."}\n`).join("\n");
  const best = bestPassages(doc, "frobnicator limit", 300);
  assert.match(best.text, /### Part 42\n\nThe frobnicator limit is 17 widgets\./);
  assert.ok(best.text.length <= 320);
});

test("API definitions become headings; reference lists and glossaries do not", () => {
  const { document } = parseHTML(`<html><body>
    <dl class="py function"><dt class="sig" id="m.f">m.f(a, b)\u00b6</dt><dd>does f</dd></dl>
    <dl><dt id="x.C">class x.C</dt><dd>a class</dd></dl>
    <dl><dt id="RFC2119">[RFC2119]</dt><dd>Bradner, S.</dd></dl>
    <dl><dt id="term">crawler</dt><dd>a program</dd></dl></body></html>`);
  definitionsAsHeadings(document);
  assert.deepEqual([...document.querySelectorAll("h4")].map((h) => h.textContent), ["m.f(a, b)", "class x.C"]);
  assert.equal(document.querySelectorAll("dt").length, 2);
});

# Web Reader

<!-- badges:start -->
[![CI](https://github.com/arhancanli/web-reader-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/arhancanli/web-reader-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/web-reader-mcp)](https://www.npmjs.com/package/web-reader-mcp)
[![downloads](https://img.shields.io/npm/dw/web-reader-mcp)](https://www.npmjs.com/package/web-reader-mcp)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/arhancanli/web-reader-mcp/badge)](https://scorecard.dev/viewer/?uri=github.com/arhancanli/web-reader-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
<!-- badges:end -->

Web pages cost agents more tokens than anything else they read, and most of those tokens are
navigation, footers and page furniture. Web Reader returns the main content of a page or PDF as
clean Markdown (the extraction behind Firefox's Reader View), and lets an agent read only what it
needs:

- **Ask the page a question:** `read_page` with `query` ranks every passage of the page and returns
  the ones that answer it, with their heading path. A 435,000-character RFC answers in 2,000.
- **Navigate long pages:** an outline with section ids, one section at a time, or the page in pages
  (`next_start`).
- **Search and count:** exact text or a regular expression, every match with context and its
  section; links with their text, tracking parameters removed.
- **PDFs** are read as text page by page.

Pages are fetched once and cached for 10 minutes, so an outline, a search and a section read cost
one download.

**Safe to point anywhere.** It reads the public web only: private, loopback, link-local (including
cloud metadata at 169.254.169.254) and other reserved addresses are refused, checked on the address
actually connected to and again on every redirect. It respects robots.txt (RFC 9309), identifies
itself honestly in its User-Agent, and does not get around bot protection. No key needed.

Built and maintained by [Arhan Canli](https://github.com/arhancanli).

## Install

<!-- install:start -->
[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=web-reader&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIndlYi1yZWFkZXItbWNwIl19)
[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=web-reader&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22web-reader-mcp%22%5D%7D)
[![Install in Goose](https://block.github.io/goose/img/extension-install-dark.svg)](https://block.github.io/goose/extension?cmd=npx&arg=-y&arg=web-reader-mcp&id=web-reader&name=Web%20Reader&description=Reads%20a%20web%20page%20or%20PDF%20the%20way%20an%20agent%20needs%20it%3A%20the%20main%20content%20without%20navigation%20or%20ads%2C%20as%20clean%20Markdown%2C%20with%20an%20outline%20to%20jump%20to%20sections%2C%20a%20query%20mode%20that%20returns%20only%20the%20passages%20that%20answer%20a%20question%2C%20in-page%20search%20and%20link%20lists.%20Refuses%20private%20and%20internal%20addresses%2C%20respects%20robots.txt%2C%20no%20key.)

Needs Node.js 20 or newer. No account or key.

**Claude Code**

```sh
claude mcp add web-reader -- npx -y web-reader-mcp
```

**Claude Desktop**: download `web-reader-mcp-<version>.mcpb` from the [latest release](https://github.com/arhancanli/web-reader-mcp/releases/latest) and open it. The bundle is signed; verify it with `gh attestation verify <file> --repo arhancanli/web-reader-mcp`.

**Any other client** (Windsurf, Zed, Cline, Continue and others), in its MCP config file:

```json
{
  "mcpServers": {
    "web-reader": {
      "command": "npx",
      "args": [
        "-y",
        "web-reader-mcp"
      ]
    }
  }
}
```

**Docker**

```sh
docker build -t web-reader-mcp https://github.com/arhancanli/web-reader-mcp.git && docker run -i --rm web-reader-mcp
```

**Hosted (Streamable HTTP)**: `node src/server.mjs --http` serves stateless MCP at `POST /mcp` (port from `PORT`, default 3000).
<!-- install:end -->

## Example

<!-- example:start -->
An agent calls `read_page` with:

```json
{
  "url": "https://www.rfc-editor.org/rfc/rfc9110.html",
  "query": "Content-Location header field",
  "max_chars": 2000
}
```

and gets back (recorded from the live server on 2026-09-26):

```json
{
  "url": "https://www.rfc-editor.org/rfc/rfc9110.html",
  "title": "RFC 9110: HTTP Semantics",
  "passages": "2 of 419 matching",
  "chars": 434823,
  "content": "[...]\n\n### 8. Representation Data and Metadata > 8.7. Content-Location\n\nThe \"Content-Location\" header field references a URI that can be used as an identifier for a specific resource corresponding to the representation in this message's content. In other words, if one were to perform a GET request on this URI at the time of this message's generation, then a 200 (OK) response would contain the same representation that is enclosed as content in this message.\n\n  Content-Location = absolute-URI / partial-URI\n\nThe field value is either an absolute-URI or a partial-URI. In the latter case (Section 4), the referenced URI is relative to the target URI ([URI], [Section 5](https://www.rfc-editor.org/rfc/rfc3986#section-5)).\n\nThe Content-Location value is not a replacement for the target URI (Section 7.1). It is representation metadata. It has the same syntax and semantics as the header field of the same name defined for MIME body parts in [Section 4](https://www.rfc-editor.org/rfc/rfc2557#section-4) of [RFC2557]. However, its appearance in an HTTP message has some special implications for HTTP recipients.\n\n[...]\n\nA user agent that sends Content-Location in a request message is stating that its value refers to where the user agent originally obtained the content of the enclosed representation (prior to any modifications made by that user agent). In other words, the user agent is providing a back link to the source of the original representation.\n\nAn origin server that receives a Content-Location field in a request message MUST treat the information as transitory request context rather than as metadata to be saved verbatim as part of the representation. An origin server MAY use that context to guide in processing the request or to save it for other uses, such as within source links or versioning metadata. However, an origin server MUST NOT use such context information to alter the request semantics."
}
```
<!-- example:end -->

## Tools

<!-- tools:start -->
| Tool | What it does |
| --- | --- |
| `find_in_page` | Finds exact text (case-insensitive) or a regular expression in a page or PDF and returns each match with surrounding context and its section id. For facts whose wording you know: a name, a number, an error message. |
| `page_links` | The links on a page (text and absolute URL, tracking parameters removed, duplicates dropped), optionally only those containing a word in text or URL, or only same-site ones. For crawling docs or finding a download. |
| `page_outline` | The headings of a page or PDF with section ids and sizes, plus title, site, date and length, to read one part with read_page section instead of the whole page. |
| `read_page` | Reads a URL as clean Markdown (main content only). With query: only the passages that answer it, from anywhere in the page. With section (from the outline): that section. Otherwise from start; long pages give an outline and next_start. |
<!-- tools:end -->

## How it behaves

- Read-only: only GET requests, to the URLs you give (and their robots.txt). Nothing is logged except
  unexpected failures (to stderr, without your inputs).
- Refused: non-http(s) URLs, URLs with credentials, and any address that is not public (checked at
  connect time and on each of at most 5 redirects). Bodies are capped at 15 MB after decompression;
  requests time out after 20 seconds.
- robots.txt is honoured for the reader's product token `web-reader-mcp` and `*`, longest match
  first, as RFC 9309 specifies. A site that refuses (a 403, a bot challenge) is reported as such.
- Options, as environment variables: `WEB_READER_ALLOW_PRIVATE=1` to read local and intranet sites
  (for example a dev server on localhost), `WEB_READER_IGNORE_ROBOTS=1` to skip robots.txt on your
  own responsibility.
- Results are compact JSON with a matching output schema. Long pages come with an outline and
  `next_start`; lists say how many items were left out.

## How it reads a page

HTML goes through [Mozilla Readability](https://github.com/mozilla/readability) (main content) and
[Turndown](https://github.com/mixmark-io/turndown) with GitHub tables (Markdown). Images and citation
markers are dropped, links made absolute. When a page is not an article (an index, a listing), the
whole page without navigation is used. PDFs are read with [unpdf](https://github.com/unjs/unpdf)
(Mozilla pdf.js). JSON is pretty-printed; plain text and Markdown are returned as they are.

## Benchmark

<!-- bench:start -->
Measured 2026-09-26 with gpt-5.4-mini, 10 fixed tasks graded by fixed checks (`bench/tasks.json`, raw results in `bench/results/`).

| Server | Correct | Input tokens | Output tokens | Tool calls | Median time |
| --- | --- | --- | --- | --- | --- |
| This server | 10/10 | 28243 | 833 | 17 | 4.0 s |
| mcp-server-fetch, the official reference fetch server | 8/10 | 418342 | 1682 | 39 | 13.1 s |
<!-- bench:end -->

## Performance

<!-- perf:start -->
Measured 2026-09-26 from Dubai, home connection against the live upstream, Node 24.19.0 (`bench/perf.json`, `scripts/perf.mjs` in the factory).

| Call | First call | Repeat | Result size |
| --- | --- | --- | --- |
| read_page: RFC 9110 (435,000 chars) with a query | 1527 ms | 18.1 ms | 2,085 chars |
| read_page: RFC 9309 from the start (long: outline and next_start) | 992 ms | 0.4 ms | 9,829 chars |
| page_outline: RFC 9309, two levels | 1308 ms | 0.3 ms | 1,019 chars |
| find_in_page: 'Pemberley' in Pride and Prejudice | 2658 ms | 0.6 ms | 3,445 chars |
| read_page: a PDF (RFC 9309) with a query | 1064 ms | 1.2 ms | 1,417 chars |
| read_page: one section of RFC 9309 (2.5. Limits) | 907 ms | 0.2 ms | 306 chars |
| page_links: Python functools docs, links about itertools | 1083 ms | 0.4 ms | 504 chars |

First call: a fresh server process, including the TLS connection and the upstream's own time. Repeat: the same call again, answered from the in-process cache, so it shows this server's own overhead.

Tool definitions the model reads on every turn (name, description, input schema): 2,290 characters, against 1,105 for mcp-server-fetch, the official reference fetch server. The full tool list, with the output schemas and annotations clients use to validate results, is 3,635 characters (1,104 for the alternative).
<!-- perf:end -->

## More MCP servers by Arhan Canli

<!-- family:start -->
- [World Time](https://github.com/arhancanli/world-time-mcp): Time anywhere, DST-safe conversions, holidays for 200+ countries, business days and meeting slots.
- [Actions Check](https://github.com/arhancanli/actions-check-mcp): Checks GitHub Actions workflows: outdated actions, old Node runtimes, retired runners, injection.
- [Citation Check](https://github.com/arhancanli/citation-check-mcp): Verifies citations: finds fabricated or mismatched references and retractions, returns clean BibTeX.
- [Config Check](https://github.com/arhancanli/config-check-mcp): Validates config files against their official schemas: tsconfig, compose, workflows, 1,400+ more.
- [Contact Check](https://github.com/arhancanli/contact-check-mcp): Validates and formats phone numbers, email addresses and postal addresses for any country.
- [Cron Check](https://github.com/arhancanli/cron-check-mcp): Explains cron expressions, lists next run times in any time zone, converts between cron dialects.
- [Dockerfile Check](https://github.com/arhancanli/dockerfile-check-mcp): Checks Dockerfiles: build-breaking mistakes, base image tags that exist, digests, platforms, EOL.
- [Domain Health](https://github.com/arhancanli/domain-health-mcp): Email and domain checks: SPF lookup limits, DKIM keys, DMARC, DNS records, registration expiry.
- [The whole collection](https://github.com/arhancanli/mcp-factory#servers), 12 more
<!-- family:end -->

## License

MIT, Copyright (c) 2026 Arhan Canli.

// The calls the golden tests replay and scripts/perf.mjs times. test/record.mjs fetches the pages
// live (robots.txt included) and stores the responses, compressed, in test/fixtures.
export const RFC9110 = "https://www.rfc-editor.org/rfc/rfc9110.html";
export const RFC9309 = "https://www.rfc-editor.org/rfc/rfc9309.html";
export const RFC9309_PDF = "https://www.rfc-editor.org/rfc/rfc9309.pdf";
export const AUSTEN = "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html";
export const FUNCTOOLS = "https://docs.python.org/3.12/library/functools.html";

export const SCENARIOS = [
  { label: "read_page: RFC 9110 (435,000 chars) with a query", tool: "read_page", args: { url: RFC9110, query: "Content-Location header field", max_chars: 2000 }, example: true },
  { label: "read_page: RFC 9309 from the start (long: outline and next_start)", tool: "read_page", args: { url: RFC9309 } },
  { label: "page_outline: RFC 9309, two levels", tool: "page_outline", args: { url: RFC9309, depth: 2 } },
  { label: "find_in_page: 'Pemberley' in Pride and Prejudice", tool: "find_in_page", args: { url: AUSTEN, text: "Pemberley", context: 40 } },
  { label: "read_page: a PDF (RFC 9309) with a query", tool: "read_page", args: { url: RFC9309_PDF, query: "parsing limit kibibytes", max_chars: 1200 } },
  { label: "read_page: one section of RFC 9309 (2.5. Limits)", tool: "read_page", args: { url: RFC9309, section: "s23" } },
  { label: "page_links: Python functools docs, links about itertools", tool: "page_links", args: { url: FUNCTOOLS, contains: "itertools" } },
  { label: "read_page: a page robots.txt disallows", tool: "read_page", args: { url: "https://nodejs.org/docs/v20.11.0/api/fs.html" }, expectError: true },
];

#!/usr/bin/env node
// web-reader: Reads a web page or PDF the way an agent needs it: the main content without navigation or ads, as clean Markdown, with an outline to jump to sections, a query mode that returns only the passages that answer a question, in-page search and link lists. Refuses private and internal addresses, respects robots.txt, no key.
//
// Tools live in src/tools/, one file each. The kit in src/kit/ is a copy of the factory kit
// (a drift test keeps it identical); it holds the network guard, the result wrapper and the
// stdio and HTTP entry points.
import { readFileSync } from "node:fs";
import { createServer, isMain, start } from "./kit/index.mjs";
import { fetchUrl } from "./net.mjs";
import { PRODUCT_TOKEN } from "./robots.mjs";
import { findInPage } from "./tools/find-in-page.mjs";
import { pageLinks } from "./tools/page-links.mjs";
import { pageOutline } from "./tools/page-outline.mjs";
import { readPage } from "./tools/read-page.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const SERVER_NAME = pkg.name;
export const SERVER_VERSION = pkg.version;
export const TOOLS = [readPage, pageOutline, findInPage, pageLinks];

export const INSTRUCTIONS = "Use read_page with a query to get only the passages that answer it; without one it returns the page from the start, with an outline when long. page_outline lists sections to read one by one (read_page section), find_in_page searches for exact text, page_links lists links. Pages are cached for 10 minutes, so follow-up calls are free.";

// fetchPage is injectable so tests replay recorded pages. The reader names itself honestly: its
// product token (for robots.txt) and where it comes from.
export function createContext({ fetchPage, env = process.env } = {}) {
  const userAgent = `Mozilla/5.0 (compatible; ${PRODUCT_TOKEN}/${SERVER_VERSION}; +${pkg.homepage})`;
  const allowPrivate = env.WEB_READER_ALLOW_PRIVATE === "1";
  return {
    userAgent,
    ignoreRobots: env.WEB_READER_IGNORE_ROBOTS === "1",
    fetchPage: fetchPage ?? ((url, opts = {}) => fetchUrl(url, { userAgent, allowPrivate, ...opts })),
  };
}

export function buildServer(ctx = createContext()) {
  return createServer({ name: SERVER_NAME, version: SERVER_VERSION, instructions: INSTRUCTIONS, tools: TOOLS, ctx });
}

if (isMain(import.meta.url)) start(() => buildServer(), SERVER_NAME);

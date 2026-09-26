// src/robots.mjs
//
// robots.txt as RFC 9309 defines it: the group for this reader's product token (web-reader-mcp)
// if the site names it, otherwise the * group; the longest matching rule wins and Allow wins a tie;
// * and $ in paths. A robots.txt that is missing (4xx) allows everything; one the site fails to
// serve (5xx, or unreachable) disallows everything for now, as the RFC says.

export const PRODUCT_TOKEN = "web-reader-mcp";

/** Rules for one user agent from a robots.txt body: [{allow: boolean, path: string}]. */
export function rulesFor(text, token = PRODUCT_TOKEN) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === "allow" || key === "disallow")) current.rules.push({ allow: key === "allow", path: value });
    }
  }
  // RFC 9309 2.2.1: the product token matches case-insensitively; groups naming it are merged.
  const mine = groups.filter((g) => g.agents.includes(token.toLowerCase()));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  // An empty path ("Disallow:") is no rule at all.
  return chosen.flatMap((g) => g.rules).filter((r) => r.path !== "");
}

function toRegex(path) {
  const anchored = path.endsWith("$");
  const body = (anchored ? path.slice(0, -1) : path)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether a path (with query) may be read under these rules. */
export function allowed(rules, pathWithQuery) {
  let best = null;
  for (const r of rules) {
    if (!toRegex(r.path).test(pathWithQuery)) continue;
    const len = r.path.replace(/\$$/, "").length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow, path: r.path };
  }
  return { ok: !best || best.allow, rule: best?.path };
}

/**
 * Checks a URL against its site's robots.txt, fetched once per origin and cached for 30 minutes.
 * @returns {Promise<{ok: boolean, rule?: string, reason?: string}>}
 */
export async function checkRobots(ctx, url) {
  const u = new URL(url);
  const origin = `${u.protocol}//${u.host}`;
  ctx.robots ??= new Map();
  const hit = ctx.robots.get(origin);
  let entry = hit && Date.now() - hit.at < 30 * 60_000 ? hit : null;
  if (!entry) {
    let state;
    try {
      const r = await ctx.fetchPage(`${origin}/robots.txt`, { maxBytes: 500_000, timeoutMs: 8_000, accept: "text/plain,*/*;q=0.5" });
      if (r.status >= 200 && r.status < 300) state = { rules: rulesFor(r.body.toString("utf8")) };
      else if (r.status >= 400 && r.status < 500) state = { rules: [] };
      else state = { blocked: `robots.txt answered ${r.status}` };
    } catch (err) {
      // A site whose robots.txt cannot be fetched at all usually cannot serve the page either;
      // the page request reports the real error, so only server errors block here.
      state = err?.code === "upstream_unreachable" || err?.code === "upstream_timeout" ? { blocked: "robots.txt could not be fetched" } : { rules: [] };
    }
    entry = { at: Date.now(), ...state };
    ctx.robots.set(origin, entry);
  }
  if (entry.blocked) return { ok: false, reason: entry.blocked };
  const verdict = allowed(entry.rules, `${u.pathname}${u.search}`);
  return { ok: verdict.ok, rule: verdict.rule };
}

import { z } from "zod";

export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
export const urlInput = z.string().max(2048).describe("http(s) URL");
export const head = (doc) => ({ url: doc.url, title: doc.title, site: doc.site, published: doc.published, pages: doc.pages });

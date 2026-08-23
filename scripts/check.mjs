#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class DOMParser {
  parseFromString(html) {
    return parseHTML(String(html || "")).document;
  }
}

const context = {
  URL,
  DOMParser,
  Date,
  console,
  JSON,
  Array,
  Map,
  Set,
  Number,
  String,
  Boolean,
  Math,
  Error,
  encodeURIComponent,
  decodeURIComponent
};
context.globalThis = context;
context.self = context;
vm.createContext(context);
vm.runInContext(readFileSync(path.join(root, "extension", "extract.js"), "utf8"), context);
const P = context.PageExtract;

const cases = [
  ["https://blog.naver.com/ppmnm/224387266849", "naver", "ppmnm"],
  ["https://blog.naver.com/PostView.naver?blogId=ppmnm&logNo=224387266849", "naver", "ppmnm"],
  ["https://m.blog.naver.com/ppmnm/224387266849", "naver", "ppmnm"],
  ["https://www.instagram.com/p/C8Qw0yANq0w/", "instagram", "C8Qw0yANq0w"],
  ["https://www.instagram.com/reel/AbC123xyz/", "instagram", "AbC123xyz"],
  ["https://instagram.com/nasa/", "instagram", "nasa"]
];

let failed = 0;
for (const [url, kind, id] of cases) {
  if (kind === "naver") {
    const parsed = P.parseNaverBlogUrl(url);
    if (!parsed || parsed.blogId !== id) {
      failed += 1;
      process.stderr.write(`FAIL naver ${url} ${JSON.stringify(parsed)}\n`);
    }
  } else {
    const parsed = P.parseInstagramUrl(url);
    const ok = parsed && (parsed.shortcode === id || parsed.username === id);
    if (!ok) {
      failed += 1;
      process.stderr.write(`FAIL instagram ${url} ${JSON.stringify(parsed)}\n`);
    }
  }
}

if (P.parseNaverBlogUrl("https://chatgpt.com/") || P.parseInstagramUrl("https://blog.naver.com/ppmnm/1")) {
  failed += 1;
  process.stderr.write("FAIL unexpected parse\n");
}

if (failed) {
  process.exit(1);
}
process.stdout.write("check ok\n");

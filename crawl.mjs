#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { parseHTML } from "linkedom";

const here = path.dirname(fileURLToPath(import.meta.url));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

class DOMParser {
  parseFromString(html) {
    return parseHTML(String(html || "")).document;
  }
}

function loadPageExtract() {
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
  vm.runInContext(readFileSync(path.join(here, "extension", "extract.js"), "utf8"), context);
  if (!context.PageExtract) {
    throw new Error("extract.js를 로드하지 못했습니다.");
  }
  return context.PageExtract;
}

function parseArgs(argv) {
  const args = { urls: [], format: "md", out: "", cookie: "", cookieFile: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--format" || token === "-f") {
      args.format = String(argv[++index] || "md").toLowerCase();
    } else if (token === "--out" || token === "-o") {
      args.out = argv[++index] || "";
    } else if (token === "--cookie") {
      args.cookie = argv[++index] || "";
    } else if (token === "--cookie-file") {
      args.cookieFile = argv[++index] || "";
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (!token.startsWith("-")) {
      args.urls.push(token);
    } else {
      throw new Error(`알 수 없는 옵션: ${token}`);
    }
  }
  return args;
}

function usage() {
  return `crollin — 페이지 본문 추출

사용법:
  crollin <URL...> [--format md|json] [--out 파일] [--cookie-file 쿠키파일]

예:
  crollin https://blog.naver.com/아이디/글번호
  crollin https://www.instagram.com/p/코드/ --format json
`;
}

function cookieHeader(args) {
  if (args.cookie) {
    return args.cookie;
  }
  if (args.cookieFile) {
    return readFileSync(args.cookieFile, "utf8").trim();
  }
  return process.env.INSTAGRAM_COOKIE || process.env.CRAWL_COOKIE || "";
}

async function fetchHtml(url, cookie) {
  const headers = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8"
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  return { html: await response.text(), finalUrl: response.url || url };
}

async function crawlNaver(PageExtract, inputUrl, cookie) {
  const parsed = PageExtract.parseNaverBlogUrl(inputUrl);
  const errors = [];
  let best = null;
  for (const target of PageExtract.naverFetchTargets(parsed)) {
    try {
      const { html, finalUrl } = await fetchHtml(target.url, cookie);
      if (PageExtract.isNaverWrapperHtml(html)) {
        errors.push(`${target.label}: iframe 껍데기만 반환됨`);
        continue;
      }
      const data = PageExtract.parseHtml(html, finalUrl, { extractionMode: target.kind });
      data.url = parsed.canonicalUrl;
      data.sourceUrl = finalUrl;
      data.extractionMode = target.kind;
      data.markdown = PageExtract.buildMarkdown(data);
      if (!best || PageExtract.extractScore(data) > PageExtract.extractScore(best)) {
        best = data;
      }
      if (!PageExtract.isThinExtract(data) && (data.body || "").length >= 200) {
        break;
      }
    } catch (error) {
      errors.push(`${target.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!best || PageExtract.isThinExtract(best)) {
    throw new Error(`네이버 블로그 본문을 가져오지 못했습니다.${errors.length ? ` (${errors.join("; ")})` : ""}`);
  }
  return best;
}

async function crawlInstagram(PageExtract, inputUrl, cookie) {
  const parsed = PageExtract.parseInstagramUrl(inputUrl);
  const errors = [];
  let best = null;
  for (const target of PageExtract.instagramFetchTargets(parsed)) {
    try {
      const { html, finalUrl } = await fetchHtml(target.url, cookie);
      const data = PageExtract.parseInstagramPage(html, finalUrl, { extractionMode: target.kind });
      data.url = parsed.canonicalUrl;
      if (!best || PageExtract.extractScore(data) > PageExtract.extractScore(best)) {
        best = data;
      }
      if (!PageExtract.isThinExtract(data)) {
        break;
      }
      if (data.loginWall) {
        errors.push(`${target.label}: 로그인 벽`);
      }
    } catch (error) {
      errors.push(`${target.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!best || PageExtract.isThinExtract(best)) {
    throw new Error(
      "인스타그램 본문을 가져오지 못했습니다. 비로그인 fetch는 로그인 벽만 받는 경우가 많습니다. "
      + "Chrome에서 해당 글을 연 뒤 확장 프로그램의 '현재 페이지 읽기'를 쓰거나, "
      + "`--cookie-file` / INSTAGRAM_COOKIE 로 sessionid를 넘기세요."
      + (errors.length ? ` (${errors.join("; ")})` : "")
    );
  }
  return best;
}

async function crawlOne(PageExtract, url, cookie) {
  if (PageExtract.parseNaverBlogUrl(url)) {
    return crawlNaver(PageExtract, url, cookie);
  }
  if (PageExtract.parseInstagramUrl(url)) {
    return crawlInstagram(PageExtract, url, cookie);
  }
  throw new Error("네이버 블로그 또는 인스타그램 URL만 지원합니다.");
}

function printResult(data, format) {
  if (format === "json") {
    const { markdown, ...rest } = data;
    return `${JSON.stringify({ ...rest, markdown }, null, 2)}\n`;
  }
  return `${data.markdown}\n`;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (args.help || args.urls.length === 0) {
    process.stdout.write(usage());
    process.exitCode = args.help ? 0 : 2;
    return;
  }
  if (args.format !== "md" && args.format !== "json") {
    process.stderr.write("--format 은 md 또는 json 이어야 합니다.\n");
    process.exitCode = 2;
    return;
  }

  const PageExtract = loadPageExtract();
  const cookie = cookieHeader(args);
  const results = [];
  for (const url of args.urls) {
    results.push(await crawlOne(PageExtract, url, cookie));
  }

  const output = args.urls.length === 1
    ? printResult(results[0], args.format)
    : args.format === "json"
      ? `${JSON.stringify(results, null, 2)}\n`
      : results.map((item) => printResult(item, "md")).join("\n---\n\n");

  if (args.out) {
    writeFileSync(args.out, output);
    process.stderr.write(`저장: ${args.out}\n`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

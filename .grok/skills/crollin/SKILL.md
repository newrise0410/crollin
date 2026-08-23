---
name: crollin
description: Read page content from URLs that generic fetchers miss, including Naver blog iframe wrappers and Instagram posts. Use when the user asks to crawl, scrape, or read a blog.naver.com or instagram.com URL, or runs /crollin or /croll.
---

# crollin

에이전트가 페이지 본문을 직접 읽는다. Jina Reader나 일반 fetch로 껍데기 HTML만 나오는 URL은 이 CLI를 쓴다.

저장소 루트에서:

```bash
npm install
node crawl.mjs "<URL>"
node crawl.mjs "<URL>" --format json
```

설치 후 `crollin <URL>` 도 같다. 로그인 벽이면 쿠키 또는 Chrome 확장을 안내한다.

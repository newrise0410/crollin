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
node crawl.mjs "<URL1>" "<URL2>" -o out.md
```

설치 후 `crollin <URL>` 도 같다.

| URL | 동작 |
|---|---|
| `https://blog.naver.com/{id}/{logNo}` | iframe 껍데기를 건너뛰고 PostView → 모바일 본문 |
| `https://www.instagram.com/p/{code}/` | 임베드·페이지 fetch. 로그인 벽이면 실패 메시지를 보고 |
| `https://www.instagram.com/{user}/` | 프로필 메타 |

로그인 벽이면 `--cookie-file` 또는 `INSTAGRAM_COOKIE`를 넘긴다. 그래도 안 되면 Chrome에서 글을 연 뒤 `extension/` 확장 프로그램의 **현재 페이지 읽기**를 안내한다.

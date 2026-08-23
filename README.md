# crollin

페이지 본문을 Markdown/JSON으로 추출합니다. 에이전트 CLI와 Chrome 확장을 함께 제공합니다.

막힌 껍데기 페이지(iframe만 있는 글 등)는 실제 본문 주소를 찾아 읽습니다.

| | CLI | Chrome 확장 |
|---|---|---|
| 대상 | Claude Code, Codex, Grok, Gemini, Hermes | 브라우저에서 한 편 읽기 |
| 공개 글 | 로그인 없이 동작하는 경우가 많음 | 동일 |
| 로그인 글 | 쿠키 또는 확장의 브라우저 세션 | 로그인한 탭에서 추출 |

지원 예: `blog.naver.com`, `instagram.com`

## CLI

```bash
npm install
node crawl.mjs "https://example.com/post"
node crawl.mjs "URL" --format json
node crawl.mjs "URL" --out post.md
```

전역 실행:

```bash
npm install -g .
crollin "URL"
```

| 옵션 | 설명 |
| --- | --- |
| `--format md\|json` | 출력 형식. 기본 `md` |
| `--out 파일` | 파일로 저장 |
| `--cookie-file 파일` | 로그인 세션 쿠키 |

에이전트는 `SKILL.md`를 읽고 위 명령을 실행하면 됩니다.

## 에이전트 스킬 등록

Claude Code, Codex, Cursor, Gemini, Grok, Hermes 등 설치된 에이전트에 한 번에 넣습니다.

```bash
npx skills add newrise0410/crollin --all -g -y
```

`-g`는 이 컴퓨터의 모든 프로젝트에서 쓰이게 하고, `--all`은 감지된 에이전트마다 스킬 폴더에 복사합니다. 내부적으로 [skills CLI](https://github.com/vercel-labs/skills)를 씁니다.

이 저장소에서:

```bash
npm run install-skill
```

## Chrome 확장

1. `chrome://extensions` → **개발자 모드**
2. **압축해제된 확장 프로그램을 로드** → `extension/` 폴더
3. 권한을 허용한 뒤 **현재 페이지 읽기** 또는 **URL로 읽기**

배포 zip:

```bash
npm run pack
```

`dist/crollin-extension-1.0.0.zip` 이 생깁니다.

ChatGPT로 보내기는 선택 기능입니다.

## 제약

- 비공개 글은 로그인된 세션이 필요합니다.
- 일부 사이트는 비로그인 fetch가 본문 없이 끝날 수 있습니다. 그때는 확장 프로그램 또는 `--cookie-file`을 쓰세요.
- 수집한 콘텐츠의 이용은 각 서비스 약관과 저작권을 따릅니다.

## 개발

```bash
npm run check
```

MIT License.

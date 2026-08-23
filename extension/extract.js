(() => {
  const root = typeof globalThis !== "undefined" ? globalThis : self;

  const MAX_BODY_CHARS = 40000;
  const MAX_COMMENT_CHARS = 12000;
  const MAX_IMAGES = 40;
  const MAX_VIDEOS = 20;

  function normalizeWhitespace(value) {
    return String(value || "")
      .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  function limitText(value, maxLength) {
    const text = String(value || "");
    if (text.length <= maxLength) {
      return { value: text, truncated: false };
    }
    return {
      value: `${text.slice(0, maxLength).trimEnd()}\n\n[내용이 길어 일부만 추출되었습니다.]`,
      truncated: true
    };
  }

  function rawText(element) {
    if (!element) {
      return "";
    }
    const inner = typeof element.innerText === "string" ? element.innerText : "";
    if (normalizeWhitespace(inner)) {
      return inner;
    }
    return element.textContent || "";
  }

  function textOf(element) {
    return normalizeWhitespace(rawText(element));
  }

  function absoluteUrl(value, baseUrl) {
    if (!value) {
      return "";
    }
    try {
      const url = new URL(value, baseUrl || "https://blog.naver.com/");
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "";
      }
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function parseNaverBlogUrl(value) {
    if (!value) {
      return null;
    }
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      return null;
    }

    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const isNaverBlog = host === "blog.naver.com" || host === "m.blog.naver.com" || host.endsWith(".blog.naver.com");
    if (!isNaverBlog) {
      return null;
    }

    const params = url.searchParams;
    let blogId = params.get("blogId") || params.get("blogid");
    let logNo = params.get("logNo") || params.get("logno") || params.get("log_no");

    const parts = url.pathname.split("/").filter(Boolean);
    const reserved = /^(PostView|PostList|PostSearchList|PostWrite|Prologue|NBlog|Guestbook)/i;
    if (!blogId && parts[0] && !reserved.test(parts[0])) {
      blogId = parts[0];
    }
    if (!logNo) {
      const numericPart = parts.find((part, index) => index > 0 && /^\d{5,}$/.test(part));
      if (numericPart) {
        logNo = numericPart;
      }
    }

    if (!blogId || !logNo || !/^\d{5,}$/.test(String(logNo))) {
      return null;
    }

    try {
      blogId = decodeURIComponent(blogId);
    } catch (error) {
      // Keep the raw blogId if it is not percent-encoded.
    }

    return {
      blogId,
      logNo: String(logNo),
      canonicalUrl: `https://blog.naver.com/${blogId}/${logNo}`
    };
  }

  function naverFetchTargets(parsed) {
    const blogId = encodeURIComponent(parsed.blogId);
    const logNo = encodeURIComponent(parsed.logNo);
    return [
      {
        url: `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`,
        kind: "naver-postview",
        label: "PostView"
      },
      {
        url: `https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`,
        kind: "naver-mobile",
        label: "모바일"
      },
      {
        url: `https://m.blog.naver.com/${blogId}/${logNo}`,
        kind: "naver-mobile",
        label: "모바일"
      }
    ];
  }

  function isNaverWrapperDocument(doc) {
    if (!doc || !doc.querySelector) {
      return false;
    }
    const frame = doc.querySelector("iframe#mainFrame") || doc.querySelector("iframe[name='mainFrame']");
    if (!frame) {
      return false;
    }
    const src = `${frame.getAttribute("src") || ""} ${frame.src || ""}`;
    return /PostView\.(naver|nhn)/i.test(src);
  }

  function isNaverWrapperHtml(html) {
    const snippet = String(html || "").slice(0, 12000);
    return /id=["']mainFrame["']/i.test(snippet)
      && /PostView\.(naver|nhn)/i.test(snippet)
      && /FramesetTitleController|framesetUrlController/i.test(snippet);
  }

  function unescapeJsonString(value) {
    try {
      return JSON.parse(`"${String(value || "")}"`);
    } catch (error) {
      return String(value || "")
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }

  function parseInstagramUrl(value) {
    if (!value) {
      return null;
    }
    let url;
    try {
      url = new URL(value);
    } catch (error) {
      return null;
    }

    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) {
      return null;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    const reserved = new Set(["p", "reel", "reels", "tv", "stories", "accounts", "explore", "direct", "about"]);
    let kind = "";
    let shortcode = "";
    let username = "";

    if (parts[0] === "p" || parts[0] === "reel" || parts[0] === "reels" || parts[0] === "tv") {
      kind = parts[0] === "tv" ? "tv" : parts[0].startsWith("reel") ? "reel" : "post";
      shortcode = parts[1] || "";
    } else if (parts[0] === "stories" && parts[1]) {
      kind = "stories";
      username = parts[1];
    } else if (parts[1] === "p" || parts[1] === "reel" || parts[1] === "reels") {
      username = parts[0];
      kind = parts[1].startsWith("reel") ? "reel" : "post";
      shortcode = parts[2] || "";
    } else if (parts[0] && !reserved.has(parts[0])) {
      kind = "profile";
      username = parts[0];
    } else {
      return null;
    }

    if (shortcode && !/^[A-Za-z0-9_-]+$/.test(shortcode)) {
      return null;
    }
    if (username && !/^[A-Za-z0-9._]+$/.test(username)) {
      return null;
    }
    if (!shortcode && !username) {
      return null;
    }

    let canonicalUrl = "https://www.instagram.com/";
    if (shortcode) {
      const path = kind === "reel" ? "reel" : kind === "tv" ? "tv" : "p";
      canonicalUrl = `https://www.instagram.com/${path}/${shortcode}/`;
    } else if (kind === "stories") {
      canonicalUrl = `https://www.instagram.com/stories/${username}/`;
    } else {
      canonicalUrl = `https://www.instagram.com/${username}/`;
    }

    return { kind, shortcode, username, canonicalUrl };
  }

  function instagramFetchTargets(parsed) {
    const targets = [];
    if (parsed.shortcode) {
      const path = parsed.kind === "reel" ? "reel" : parsed.kind === "tv" ? "tv" : "p";
      targets.push({
        url: `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`,
        kind: "instagram-embed",
        label: "임베드"
      });
      targets.push({
        url: `https://www.instagram.com/${path}/${parsed.shortcode}/`,
        kind: "instagram-post",
        label: "게시물"
      });
    } else if (parsed.username) {
      targets.push({
        url: `https://www.instagram.com/${encodeURIComponent(parsed.username)}/`,
        kind: "instagram-profile",
        label: "프로필"
      });
    }
    return targets;
  }

  function isInstagramLoginWallHtml(html) {
    const text = String(html || "");
    if (text.length < 800) {
      return true;
    }
    const hasMediaMeta = /property=["']og:(?:description|image|video)["']/i.test(text)
      || /application\/ld\+json/i.test(text)
      || /class=["']Caption["']/i.test(text)
      || /"caption"\s*:\s*\{\s*"text"/i.test(text);
    if (hasMediaMeta) {
      return false;
    }
    return /accounts\/login|log in to instagram|로그인하고 instagram|login_required/i.test(text)
      || /<title>\s*instagram\s*<\/title>/i.test(text);
  }

  function detectSite(url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host === "blog.naver.com" || host === "m.blog.naver.com" || host.endsWith(".blog.naver.com")) {
        return "naver-blog";
      }
      if (host === "instagram.com" || host.endsWith(".instagram.com")) {
        return "instagram";
      }
    } catch (error) {
      // A malformed URL is handled as a generic page below.
    }
    return "generic";
  }

  function siteLabel(site) {
    if (site === "naver-blog") {
      return "네이버 블로그";
    }
    if (site === "instagram") {
      return "인스타그램";
    }
    return "일반 웹페이지";
  }

  function getMetaContent(doc, selectors) {
    if (!doc || !doc.querySelector) {
      return "";
    }
    for (const selector of selectors) {
      const element = doc.querySelector(selector);
      const value = element && element.getAttribute("content");
      if (value && normalizeWhitespace(value)) {
        return normalizeWhitespace(value);
      }
    }
    return "";
  }

  function readableLineList(root) {
    const raw = rawText(root);
    const lines = String(raw)
      .replace(/\u00a0/g, " ")
      .split(/\r?\n/)
      .map(normalizeWhitespace)
      .filter(Boolean);

    const result = [];
    for (const line of lines) {
      if (result[result.length - 1] === line) {
        continue;
      }
      result.push(line);
    }
    return result;
  }

  function extractReadableText(root, site) {
    const clone = root.cloneNode(true);
    const removableSelector = [
      "script",
      "style",
      "noscript",
      "template",
      "iframe",
      "svg",
      "canvas",
      "button",
      "input",
      "textarea",
      "select",
      "option",
      "form",
      "nav",
      "footer",
      "aside",
      "[aria-hidden=\"true\"]",
      "[hidden]",
      "[role=\"button\"]",
      "[class*=\"blind\"]",
      "[class*=\"Blind\"]",
      "[class*=\"skip\"]",
      "[class*=\"advert\"]",
      "[id*=\"advert\"]",
      "[class*=\"sponsor\"]",
      "[id*=\"sponsor\"]"
    ].join(",");

    clone.querySelectorAll(removableSelector).forEach((element) => element.remove());

    if (site === "instagram") {
      clone.querySelectorAll("ul").forEach((element) => element.remove());
    }

    let lines = readableLineList(clone);
    lines = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
    return limitText(lines.join("\n\n"), MAX_BODY_CHARS);
  }

  function selectorsForSite(site) {
    if (site === "naver-blog") {
      return [
        [".se-main-container", 380],
        ["#postViewArea", 360],
        [".se_component_wrap", 320],
        [".post_ct", 300],
        ["#content-area", 260],
        ["#viewTypeSelector", 240],
        ["article", 220],
        ["main", 180]
      ];
    }

    if (site === "instagram") {
      return [
        ["article", 360],
        ["main", 260],
        ["div[role=\"main\"]", 240],
        ["[data-testid=\"post-container\"]", 230]
      ];
    }

    return [
      ["[itemprop=\"articleBody\"]", 340],
      ["article", 300],
      ["main", 250],
      [".article-content", 220],
      [".article-body", 220],
      [".post-content", 220],
      [".entry-content", 220],
      ["[role=\"main\"]", 180]
    ];
  }

  function scoreCandidate(element, priority, site) {
    const textLength = textOf(element).length;
    const paragraphCount = element.querySelectorAll("p, h1, h2, h3, li, blockquote").length;
    const imageCount = element.querySelectorAll("img").length;
    let score = priority + Math.min(textLength, 30000) / 120 + paragraphCount * 5 + imageCount * 14;

    if (element === element.ownerDocument.body) {
      score -= 160;
    }
    if (site === "instagram" && element.matches("article")) {
      score += 100;
    }
    if (site === "naver-blog" && element.matches("#postViewArea, .se-main-container")) {
      score += 100;
    }
    return score;
  }

  function findContentRoot(doc, site, baseUrl) {
    if (site === "naver-blog") {
      const preferredSelectors = [".se-main-container", "#postViewArea", ".se_component_wrap", ".post_ct"];
      for (const selector of preferredSelectors) {
        const preferred = doc.querySelector(selector);
        if (preferred && (textOf(preferred).length >= 40 || preferred.querySelectorAll("img, video").length > 0)) {
          return { element: preferred, baseUrl, score: 1000 };
        }
      }
    }

    const candidates = new Map();
    for (const [selector, priority] of selectorsForSite(site)) {
      doc.querySelectorAll(selector).forEach((element) => {
        if (!candidates.has(element) || candidates.get(element) < priority) {
          candidates.set(element, priority);
        }
      });
    }

    if (doc.body) {
      candidates.set(doc.body, candidates.get(doc.body) || 0);
    }

    let best = null;
    for (const [element, priority] of candidates) {
      const textLength = textOf(element).length;
      if (textLength < 20 && element.querySelectorAll("img, video").length === 0) {
        continue;
      }
      const score = scoreCandidate(element, priority, site);
      if (!best || score > best.score) {
        best = { element, baseUrl, score };
      }
    }

    if (best) {
      return best;
    }

    return {
      element: doc.body || doc.documentElement,
      baseUrl,
      score: 0
    };
  }

  function firstText(root, selectors) {
    if (!root || !root.querySelector) {
      return "";
    }
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const value = textOf(element);
      if (value) {
        return value;
      }
    }
    return "";
  }

  function extractAuthor(root, site, doc) {
    const metaAuthor = getMetaContent(doc, [
      "meta[property=\"naverblog:nickname\"]",
      "meta[name=\"author\"]",
      "meta[property=\"article:author\"]"
    ]);
    if (metaAuthor && !/^네이버 블로그/.test(metaAuthor)) {
      return metaAuthor;
    }

    if (site === "instagram") {
      const candidates = root.querySelectorAll("header a, a[href^=\"/\"]");
      for (const candidate of candidates) {
        const value = textOf(candidate);
        if (value && value.length <= 80 && !/^follow|팔로우$/i.test(value)) {
          return value;
        }
      }
    }

    if (site === "naver-blog") {
      return firstText(doc, [
        ".nick a",
        ".nick",
        ".blog_author",
        ".writer .nick",
        "[class*=\"nick\"]"
      ]) || firstText(root, [
        ".nick",
        ".blog_name",
        ".blog_name a",
        "[class*=\"writer\"]"
      ]) || metaAuthor;
    }

    return firstText(root, [
      "[rel=\"author\"]",
      ".author",
      ".byline",
      "[class*=\"author\"]"
    ]) || metaAuthor;
  }

  function extractPublishedAt(root, doc) {
    const dateText = firstText(doc, [
      ".se_publishDate",
      ".se_publishDate.pcol2",
      ".date.fil5",
      ".blog2_container .date",
      "span.date"
    ]);
    if (dateText) {
      return dateText;
    }

    const time = (root && root.querySelector("time[datetime]")) || doc.querySelector("time[datetime]");
    if (time) {
      return normalizeWhitespace(time.getAttribute("datetime") || time.textContent);
    }
    return getMetaContent(doc, [
      "meta[property=\"article:published_time\"]",
      "meta[name=\"date\"]",
      "meta[itemprop=\"datePublished\"]"
    ]);
  }

  function extractTitle(root, doc) {
    const heading = firstText(doc, [".se-title-text", ".pcol1 .se-title-text", ".se_textarea"])
      || firstText(root, ["h1", "h2", "h3"]);
    const ogTitle = getMetaContent(doc, ["meta[property=\"og:title\"]"]);
    const documentTitle = normalizeWhitespace(doc.title || "");
    const picked = ogTitle || (heading && heading.length <= 300 ? heading : "") || documentTitle || "제목 없음";
    return picked.replace(/\s*:\s*네이버 블로그\s*$/, "").slice(0, 300);
  }

  function upgradeNaverImageUrl(url) {
    try {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type") || "";
      if (/blur|w80|w11|s1|s40/i.test(type)) {
        parsed.searchParams.set("type", "w966");
      }
      return parsed.href;
    } catch (error) {
      return url;
    }
  }

  function getImageSource(image, baseUrl) {
    const candidates = [
      image.getAttribute("data-lazy-src"),
      image.getAttribute("data-src"),
      image.getAttribute("data-original"),
      image.currentSrc,
      image.getAttribute("src"),
      (image.getAttribute("data-lazy-srcset") || "").split(",")[0]?.trim().split(/\s+/)[0],
    ];

    const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset");
    if (srcset) {
      const largest = srcset
        .split(",")
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean)
        .pop();
      if (largest) {
        candidates.unshift(largest);
      }
    }

    for (const candidate of candidates) {
      const url = absoluteUrl(candidate, baseUrl);
      if (url) {
        return upgradeNaverImageUrl(url);
      }
    }
    return "";
  }

  function numericAttribute(element, name) {
    const value = Number.parseInt(element.getAttribute(name) || "", 10);
    return Number.isFinite(value) ? value : 0;
  }

  function isDecorativeImage(url, alt, className, width, height) {
    const descriptor = `${alt} ${className || ""} ${url}`;
    if (/blogpfthumb|profileImage|ssl\.pstatic\.net\/static|blogimgs\.pstatic\.net|ico_|btn_|favicon/i.test(descriptor)) {
      return true;
    }
    if ((width && width < 80 && height && height < 80) || (/avatar|profile|프로필|로고|logo|icon|아이콘/i.test(descriptor) && width && width < 300)) {
      return true;
    }
    return false;
  }

  function collectImages(root, baseUrl, site, doc) {
    const images = [];
    const seen = new Set();

    for (const image of root.querySelectorAll("img")) {
      const url = getImageSource(image, baseUrl);
      if (!url || seen.has(url)) {
        continue;
      }

      const alt = normalizeWhitespace(image.getAttribute("alt") || image.getAttribute("title") || "");
      const width = image.naturalWidth || numericAttribute(image, "width");
      const height = image.naturalHeight || numericAttribute(image, "height");
      if (isDecorativeImage(url, alt, image.className, width, height)) {
        continue;
      }

      seen.add(url);
      images.push({ url, alt, width, height });
      if (images.length >= MAX_IMAGES) {
        break;
      }
    }

    if (images.length === 0) {
      const ogImage = getMetaContent(doc, ["meta[property=\"og:image\"]"]);
      const url = absoluteUrl(ogImage, baseUrl);
      if (url && !isDecorativeImage(url, "대표 이미지", "", 0, 0)) {
        images.push({ url: upgradeNaverImageUrl(url), alt: "대표 이미지", width: 0, height: 0 });
      }
    }

    return images;
  }

  function collectVideos(root, baseUrl) {
    const videos = [];
    const seen = new Set();

    for (const video of root.querySelectorAll("video")) {
      const source = video.currentSrc || video.getAttribute("src") || video.querySelector("source")?.getAttribute("src");
      const url = absoluteUrl(source, baseUrl);
      const poster = absoluteUrl(video.getAttribute("poster"), baseUrl);
      if (url && !seen.has(url)) {
        seen.add(url);
        videos.push({ url, poster });
      } else if (poster && !seen.has(poster)) {
        seen.add(poster);
        videos.push({ url: "", poster });
      }
      if (videos.length >= MAX_VIDEOS) {
        break;
      }
    }
    return videos;
  }

  function collectInstagramComments(root) {
    const comments = [];
    const seen = new Set();

    for (const item of root.querySelectorAll("li")) {
      if (item.querySelector("li")) {
        continue;
      }
      const value = textOf(item);
      if (
        value.length < 3 ||
        value.length > 1000 ||
        /^(좋아요|like|답글 달기|reply|번역 보기|view translation|팔로우|follow)$/i.test(value)
      ) {
        continue;
      }
      if (!seen.has(value)) {
        seen.add(value);
        comments.push(value);
      }
    }

    const limited = limitText(comments.join("\n\n"), MAX_COMMENT_CHARS);
    return {
      values: limited.value ? limited.value.split(/\n\n/).filter(Boolean) : [],
      truncated: limited.truncated
    };
  }

  function extractionModeLabel(mode) {
    if (mode === "naver-postview") {
      return "PostView 직접 요청";
    }
    if (mode === "naver-mobile") {
      return "모바일 페이지 직접 요청";
    }
    if (mode === "instagram-embed") {
      return "인스타 임베드";
    }
    if (mode === "instagram-post" || mode === "instagram-profile") {
      return "인스타그램 직접 요청";
    }
    if (mode === "instagram-tab") {
      return "브라우저 탭 (인스타그램)";
    }
    if (mode === "live-frame") {
      return "브라우저 탭 iframe 본문";
    }
    return "현재 탭";
  }

  function buildMarkdown(data) {
    const lines = [`# ${data.title}`, `URL: ${data.url}`, `사이트: ${data.siteLabel}`];
    if (data.author) {
      lines.push(`작성자: ${data.author}`);
    }
    if (data.publishedAt) {
      lines.push(`작성일: ${data.publishedAt}`);
    }
    if (data.extractionMode) {
      lines.push(`추출: ${extractionModeLabel(data.extractionMode)}`);
    }
    if (data.description && data.description !== data.title) {
      lines.push(`설명: ${data.description}`);
    }

    lines.push("", "## 본문", data.body || "(본문 텍스트를 찾지 못했습니다.)");

    if (data.images.length > 0) {
      lines.push("", "## 이미지");
      data.images.forEach((image, index) => {
        const label = image.alt ? `${image.alt} — ` : "";
        lines.push(`${index + 1}. ${label}${image.url}`);
      });
    }

    if (data.videos.length > 0) {
      lines.push("", "## 동영상");
      data.videos.forEach((video, index) => {
        const target = video.url || video.poster;
        lines.push(`${index + 1}. ${target}`);
      });
    }

    if (data.comments.length > 0) {
      lines.push("", "## 현재 로드된 댓글");
      data.comments.forEach((comment, index) => {
        lines.push(`${index + 1}. ${comment}`);
      });
    }

    return lines.join("\n").trim();
  }

  function finalizeData(data) {
    data.markdown = buildMarkdown(data);
    data.stats = {
      characters: data.markdown.length,
      bodyCharacters: data.body.length,
      images: data.images.length,
      videos: data.videos.length,
      comments: data.comments.length,
      bodyTruncated: data.bodyTruncated,
      commentsTruncated: data.commentsTruncated
    };
    return data;
  }

  function extractFromDocument(doc, pageUrl, options = {}) {
    const url = pageUrl || "";
    const site = detectSite(url);
    const selected = findContentRoot(doc, site, url);
    const root = selected.element || doc.body || doc.documentElement;
    const body = extractReadableText(root, site);
    const images = collectImages(root, selected.baseUrl || url, site, doc);
    const videos = collectVideos(root, selected.baseUrl || url);
    const commentData = site === "instagram"
      ? collectInstagramComments(root)
      : { values: [], truncated: false };

    const parsed = parseNaverBlogUrl(url) || parseInstagramUrl(url);
    const data = {
      version: 1,
      extractedAt: new Date().toISOString(),
      url: parsed?.canonicalUrl || url,
      sourceUrl: url,
      title: extractTitle(root, doc),
      site,
      siteLabel: siteLabel(site),
      author: extractAuthor(root, site, doc),
      publishedAt: extractPublishedAt(root, doc),
      description: getMetaContent(doc, [
        "meta[property=\"og:description\"]",
        "meta[name=\"description\"]"
      ]),
      body: body.value,
      bodyTruncated: body.truncated,
      images,
      videos,
      comments: commentData.values,
      commentsTruncated: commentData.truncated,
      isNaverWrapper: isNaverWrapperDocument(doc),
      extractionMode: options.extractionMode || "live"
    };

    return finalizeData(data);
  }

  function getCandidateDocuments() {
    const documents = [{ doc: document, baseUrl: window.location.href }];
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentDocument && frame.contentDocument.body) {
          documents.push({
            doc: frame.contentDocument,
            baseUrl: frame.contentWindow.location.href
          });
        }
      } catch (error) {
        // Cross-origin frames cannot be inspected from this frame.
      }
    }
    return documents;
  }

  function extractFromWindow() {
    const pageUrl = (() => {
      try {
        return window.top.location.href;
      } catch (error) {
        return window.location.href;
      }
    })();

    const site = detectSite(pageUrl);
    let best = null;
    let wrapper = isNaverWrapperDocument(document);

    for (const { doc, baseUrl } of getCandidateDocuments()) {
      wrapper = wrapper || isNaverWrapperDocument(doc);
      const selected = findContentRoot(doc, site, baseUrl);
      if (!best || selected.score > best.score) {
        best = { ...selected, doc };
      }
    }

    const chosenDoc = best?.doc || document;
    const data = extractFromDocument(chosenDoc, best?.baseUrl || pageUrl, {
      extractionMode: wrapper ? "live-frame" : "live"
    });
    data.url = pageUrl;
    data.isNaverWrapper = wrapper;
    if (wrapper) {
      data.extractionMode = "live-frame";
    }
    return finalizeData(data);
  }

  function parseHtml(html, pageUrl, options = {}) {
    if (typeof DOMParser === "undefined") {
      throw new Error("이 환경에서는 HTML을 해석할 수 없습니다.");
    }
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    return extractFromDocument(doc, pageUrl, options);
  }

  function firstRegexGroup(html, patterns) {
    for (const pattern of patterns) {
      const match = String(html || "").match(pattern);
      if (match && match[1]) {
        return unescapeJsonString(match[1]).trim();
      }
    }
    return "";
  }

  function collectInstagramImagesFromHtml(html, baseUrl) {
    const images = [];
    const seen = new Set();
    const patterns = [
      /property=["']og:image["']\s+content=["']([^"']+)/gi,
      /content=["']([^"']+)["']\s+property=["']og:image["']/gi,
      /class=["']EmbeddedMediaImage["'][^>]*src=["']([^"']+)/gi,
      /"display_url"\s*:\s*"([^"]+)"/g,
      /"image_versions2"[^]]*?"url"\s*:\s*"([^"]+)"/g
    ];
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(html);
      while (match) {
        const url = absoluteUrl(unescapeJsonString(match[1]), baseUrl);
        if (url && !seen.has(url) && !/static\.cdninstagram\.com\/rsrc|scontent.*s150x150/i.test(url)) {
          seen.add(url);
          images.push({ url, alt: "", width: 0, height: 0 });
        }
        if (images.length >= MAX_IMAGES) {
          return images;
        }
        match = pattern.exec(html);
      }
    }
    return images;
  }

  function parseInstagramPage(html, pageUrl, options = {}) {
    const parsed = parseInstagramUrl(pageUrl);
    const fromDom = parseHtml(html, parsed?.canonicalUrl || pageUrl, options);
    const caption = firstRegexGroup(html, [
      /"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/,
      /property=["']og:description["']\s+content=["']([^"']+)/i,
      /content=["']([^"']+)["']\s+property=["']og:description["']/i,
      /class=["']Caption["'][^>]*>([\s\S]*?)<\/p>/i
    ]);
    const author = firstRegexGroup(html, [
      /"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/,
      /"username"\s*:\s*"([^"]+)"/,
      /property=["']og:title["']\s+content=["']([^"']+)/i
    ]) || fromDom.author;
    const ogImage = collectInstagramImagesFromHtml(html, parsed?.canonicalUrl || pageUrl);
    const videos = [];
    const ogVideo = firstRegexGroup(html, [
      /property=["']og:video["']\s+content=["']([^"']+)/i,
      /"video_url"\s*:\s*"([^"]+)"/
    ]);
    if (ogVideo) {
      videos.push({ url: ogVideo, poster: ogImage[0]?.url || "" });
    }

    let body = fromDom.body;
    if (caption && caption.length > (body || "").length) {
      body = caption.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    }
    if (isInstagramLoginWallHtml(html) && (!body || body.length < 40)) {
      body = "";
    }

    const title = firstRegexGroup(html, [
      /property=["']og:title["']\s+content=["']([^"']+)/i,
      /<title>([\s\S]*?)<\/title>/i
    ]) || fromDom.title || (parsed?.shortcode ? `Instagram ${parsed.shortcode}` : "Instagram");

    const data = {
      ...fromDom,
      url: parsed?.canonicalUrl || pageUrl,
      sourceUrl: pageUrl,
      site: "instagram",
      siteLabel: "인스타그램",
      title: normalizeWhitespace(title).replace(/\s*[•|]\s*instagram\s*$/i, "") || title,
      author: author.replace(/\s+on Instagram.*$/i, "").replace(/^@/, ""),
      body,
      bodyTruncated: false,
      images: ogImage.length > 0 ? ogImage : fromDom.images,
      videos: videos.length > 0 ? videos : fromDom.videos,
      loginWall: isInstagramLoginWallHtml(html) && (!body || body.length < 40),
      extractionMode: options.extractionMode || "instagram-post"
    };
    data.bodyTruncated = false;
    return finalizeData(data);
  }

  function isThinExtract(data) {
    if (!data) {
      return true;
    }
    if (data.isNaverWrapper || data.loginWall) {
      return true;
    }
    const body = String(data.body || "");
    const images = data.images?.length || 0;
    const videos = data.videos?.length || 0;
    if (data.site === "instagram" && /^(instagram|log in|로그인|sign up)$/i.test(body.trim())) {
      return true;
    }
    return body.length < 80 && images === 0 && videos === 0;
  }

  function extractScore(data) {
    if (!data) {
      return -1;
    }
    return (data.body || "").length + (data.images?.length || 0) * 80 + (data.videos?.length || 0) * 80;
  }

  root.PageExtract = {
    parseNaverBlogUrl,
    naverFetchTargets,
    parseInstagramUrl,
    instagramFetchTargets,
    isNaverWrapperDocument,
    isNaverWrapperHtml,
    isInstagramLoginWallHtml,
    extractFromWindow,
    extractFromDocument,
    parseHtml,
    parseInstagramPage,
    isThinExtract,
    extractScore,
    buildMarkdown,
    detectSite,
    extractionModeLabel
  };
})();

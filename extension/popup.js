const state = {
  tab: null,
  data: null
};

const elements = {
  extractButton: document.querySelector("#extractButton"),
  urlInput: document.querySelector("#urlInput"),
  urlButton: document.querySelector("#urlButton"),
  optionsButton: document.querySelector("#optionsButton"),
  openChatButton: document.querySelector("#openChatButton"),
  copyButton: document.querySelector("#copyButton"),
  sendButton: document.querySelector("#sendButton"),
  copyResultButton: document.querySelector("#copyResultButton"),
  status: document.querySelector("#status"),
  pageSummary: document.querySelector("#pageSummary"),
  siteBadge: document.querySelector("#siteBadge"),
  pageTitle: document.querySelector("#pageTitle"),
  stats: document.querySelector("#stats"),
  prompt: document.querySelector("#prompt"),
  preview: document.querySelector("#preview"),
  previewLength: document.querySelector("#previewLength"),
  resultSection: document.querySelector("#resultSection"),
  result: document.querySelector("#result")
};

function setStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${type}`.trim();
}

function setBusy(isBusy) {
  elements.extractButton.disabled = isBusy;
  elements.urlButton.disabled = isBusy;
  elements.sendButton.disabled = isBusy || !state.data;
  elements.copyButton.disabled = isBusy || !state.data;
  elements.openChatButton.disabled = isBusy;
  elements.extractButton.textContent = isBusy ? "읽는 중…" : "현재 페이지 읽기";
  elements.urlButton.textContent = isBusy ? "가져오는 중…" : "URL로 읽기";
}

function renderData(data) {
  state.data = data;
  elements.pageSummary.classList.remove("hidden");
  const mode = data.extractionMode && PageExtract.extractionModeLabel(data.extractionMode);
  elements.siteBadge.textContent = mode && (data.site === "naver-blog" || data.site === "instagram")
    ? `${data.siteLabel} · ${mode}`
    : data.siteLabel;
  elements.pageTitle.textContent = data.title || "제목 없음";
  elements.stats.replaceChildren();

  const stats = [
    `${data.stats.bodyCharacters.toLocaleString()}자`,
    `이미지 ${data.stats.images}`,
    data.stats.videos ? `동영상 ${data.stats.videos}` : "",
    data.stats.comments ? `댓글 ${data.stats.comments}` : ""
  ].filter(Boolean);

  stats.forEach((label) => {
    const span = document.createElement("span");
    span.textContent = label;
    elements.stats.appendChild(span);
  });

  elements.preview.textContent = data.markdown;
  elements.previewLength.textContent = `${data.markdown.length.toLocaleString()}자`;
  elements.copyButton.disabled = false;
  elements.sendButton.disabled = false;
  elements.resultSection.classList.add("hidden");
  elements.result.textContent = "";
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.id !== "number") {
    throw new Error("현재 활성 탭을 찾을 수 없습니다.");
  }
  return tab;
}

function pickBestExtract(results) {
  const usable = results.filter((data) => data && !data.error && (data.body || data.images?.length || data.videos?.length));
  usable.sort((left, right) => PageExtract.extractScore(right) - PageExtract.extractScore(left));
  return usable[0] || null;
}

async function extractFromTab(tab) {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ["extract.js", "content.js"]
  });

  const injected = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      try {
        if (typeof window.__pageToGptExtract !== "function") {
          return null;
        }
        return window.__pageToGptExtract();
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  });

  const results = (injected || []).map((item) => item?.result).filter(Boolean);
  const best = pickBestExtract(results);
  if (best) {
    return best;
  }

  const firstError = results.find((item) => item?.error);
  throw new Error(firstError?.error || "페이지 내용을 추출하지 못했습니다.");
}

async function crawlRemote(url) {
  const response = await chrome.runtime.sendMessage({
    type: "CRAWL_URL",
    url
  });
  if (!response || !response.ok) {
    throw new Error(response?.error || "본문을 가져오지 못했습니다.");
  }
  return response.data;
}

function supportedRemoteUrl(url) {
  return Boolean(PageExtract.parseNaverBlogUrl(url) || PageExtract.parseInstagramUrl(url));
}

async function enrichIfNeeded(url, data) {
  if (!supportedRemoteUrl(url)) {
    return { data, note: "" };
  }
  if (data && !PageExtract.isThinExtract(data)) {
    return { data, note: "" };
  }

  const crawled = await crawlRemote(url);
  const naverNote = PageExtract.parseNaverBlogUrl(url)
    ? " PC 주소는 iframe 껍데기라 글이 안 열린 것처럼 보입니다."
    : "";
  return {
    data: crawled,
    note: `${PageExtract.extractionModeLabel(crawled.extractionMode)}로 본문을 가져왔습니다.${naverNote}`
  };
}

function successMessage(data, extraNote) {
  const truncationMessage = data.stats.bodyTruncated ? " (본문은 길이 제한으로 일부만 표시)" : "";
  if (extraNote) {
    return `추출 완료${truncationMessage}. ${extraNote}`;
  }
  if (data.extractionMode && data.extractionMode !== "live") {
    return `추출 완료${truncationMessage}. ${PageExtract.extractionModeLabel(data.extractionMode)}에서 본문을 읽었습니다.`;
  }
  return `추출 완료${truncationMessage}. 현재 페이지에서 로드된 내용만 포함했습니다.`;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

async function sendToChatGPT() {
  if (!state.data) {
    return;
  }

  const settings = await chrome.storage.local.get({ autoSubmit: true });
  const request = elements.prompt.value.trim() || "이 페이지의 핵심 내용을 한국어로 요약해 주세요.";
  const text = `${request}\n\n다음은 사용자가 현재 브라우저에서 직접 열어 본 페이지에서 추출한 내용입니다.\n\n${state.data.markdown}`;

  elements.sendButton.disabled = true;
  setStatus("로그인된 ChatGPT 웹 화면을 열고 내용을 입력하는 중…");
  elements.resultSection.classList.add("hidden");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "OPEN_CHATGPT",
      text,
      autoSubmit: settings.autoSubmit !== false
    });
    if (!response || !response.ok) {
      throw new Error(response?.error || "ChatGPT 웹 화면에 내용을 전달하지 못했습니다.");
    }
    setStatus(settings.autoSubmit === false ? "ChatGPT에 내용을 입력했습니다." : "ChatGPT로 전송했습니다.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    elements.sendButton.disabled = !state.data;
  }
}

async function readCurrentPage() {
  setBusy(true);
  setStatus("현재 탭의 모든 프레임을 읽고 본문을 정제하고 있습니다…");

  try {
    state.tab = await getActiveTab();
    const tabUrl = state.tab.url || "";
    if (supportedRemoteUrl(tabUrl) && elements.urlInput) {
      elements.urlInput.value = tabUrl;
    }

    let data = null;
    let liveError = "";
    try {
      data = await extractFromTab(state.tab);
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
    }

    const enriched = await enrichIfNeeded(tabUrl, data);
    if (!enriched.data) {
      throw new Error(liveError || "페이지 내용을 추출하지 못했습니다.");
    }

    renderData(enriched.data);
    setStatus(successMessage(enriched.data, enriched.note), "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`추출 실패: ${message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function readFromUrl() {
  const url = elements.urlInput.value.trim();
  if (!url) {
    setStatus("네이버 블로그 URL을 입력해 주세요.", "error");
    return;
  }
  if (!supportedRemoteUrl(url)) {
    setStatus("네이버 블로그 또는 인스타그램 URL이 아닙니다.", "error");
    return;
  }

  setBusy(true);
  setStatus(PageExtract.parseNaverBlogUrl(url)
    ? "iframe 껍데기를 건너뛰고 PostView/모바일 본문을 가져오는 중…"
    : "인스타그램 본문을 가져오는 중… Chrome 로그인 세션을 사용할 수 있습니다.");

  try {
    const data = await crawlRemote(url);
    renderData(data);
    setStatus(successMessage(data), "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`추출 실패: ${message}`, "error");
  } finally {
    setBusy(false);
  }
}

async function prefillUrl() {
  try {
    const tab = await getActiveTab();
    if (tab.url && supportedRemoteUrl(tab.url) && !elements.urlInput.value) {
      elements.urlInput.value = tab.url;
    }
  } catch (error) {
    // Popup can open on chrome:// pages where the tab URL is unavailable.
  }
}

elements.extractButton.addEventListener("click", readCurrentPage);
elements.urlButton.addEventListener("click", readFromUrl);
elements.urlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    readFromUrl();
  }
});

elements.openChatButton.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "https://chatgpt.com/", active: true });
  } catch (error) {
    setStatus("ChatGPT를 열지 못했습니다.", "error");
  }
});

elements.copyButton.addEventListener("click", async () => {
  if (!state.data) {
    return;
  }
  await copyText(state.data.markdown);
  setStatus("Markdown을 클립보드에 복사했습니다.", "success");
});

elements.sendButton.addEventListener("click", sendToChatGPT);

elements.copyResultButton.addEventListener("click", async () => {
  const value = elements.result.textContent.trim();
  if (!value) {
    return;
  }
  await copyText(value);
  setStatus("GPT 응답을 클립보드에 복사했습니다.", "success");
});

elements.optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

prefillUrl();

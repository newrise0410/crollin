importScripts("extract.js");

const CHATGPT_HOME = "https://chatgpt.com/";
const MAX_CHATGPT_WAIT_MS = 20_000;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function findOrCreateChatGPTTab() {
  const existingTabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  });
  const existingTab = existingTabs.find((tab) => typeof tab.id === "number");

  if (existingTab && typeof existingTab.id === "number") {
    await chrome.tabs.update(existingTab.id, { active: true });
    return existingTab;
  }

  return chrome.tabs.create({ url: CHATGPT_HOME, active: true });
}

async function sendToChatGPTTab(tabId, text, autoSubmit) {
  const startedAt = Date.now();
  let lastError = "ChatGPT 입력창을 아직 찾지 못했습니다.";

  while (Date.now() - startedAt < MAX_CHATGPT_WAIT_MS) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "FILL_CHATGPT",
        text,
        autoSubmit
      });
      if (result?.ok) {
        return result;
      }
      lastError = result?.error || lastError;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }

  throw new Error(`${lastError} ChatGPT에 로그인되어 있는지 확인해 주세요.`);
}

async function openChatGPTAndSend(message) {
  const tab = await findOrCreateChatGPTTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("ChatGPT 탭을 열지 못했습니다.");
  }

  const result = await sendToChatGPTTab(tab.id, message.text, message.autoSubmit !== false);
  await chrome.storage.local.set({
    lastTransferAt: new Date().toISOString(),
    lastTransferError: ""
  });
  return { tabId: tab.id, ...result };
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) {
    throw new Error(`${url} → HTTP ${response.status}`);
  }
  return {
    html: await response.text(),
    finalUrl: response.url || url
  };
}

async function crawlNaverBlog(inputUrl) {
  const parsed = PageExtract.parseNaverBlogUrl(inputUrl);
  if (!parsed) {
    throw new Error("네이버 블로그 URL이 아닙니다. blog.naver.com/아이디/글번호 형식을 확인해 주세요.");
  }

  const errors = [];
  let best = null;

  for (const target of PageExtract.naverFetchTargets(parsed)) {
    try {
      const { html, finalUrl } = await fetchHtml(target.url);
      if (PageExtract.isNaverWrapperHtml(html)) {
        errors.push(`${target.label}: iframe 껍데기만 반환됨`);
        continue;
      }
      const data = PageExtract.parseHtml(html, finalUrl, {
        extractionMode: target.kind
      });
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
    const detail = errors.length ? ` (${errors.join("; ")})` : "";
    throw new Error(`네이버 블로그 본문을 가져오지 못했습니다.${detail}`);
  }

  return best;
}

function pickBestFrameExtract(results) {
  const usable = (results || []).filter((data) => data && !data.error && (data.body || data.images?.length || data.videos?.length));
  usable.sort((left, right) => PageExtract.extractScore(right) - PageExtract.extractScore(left));
  return usable[0] || null;
}

function waitTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === "complete") {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        finish();
      }
    }).catch((error) => finish(error));
    setTimeout(() => finish(new Error("페이지 로딩 시간 초과")), timeoutMs);
  });
}

async function extractOpenTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["extract.js", "content.js"]
  });
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      try {
        return typeof window.__pageToGptExtract === "function" ? window.__pageToGptExtract() : null;
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    }
  });
  return pickBestFrameExtract((injected || []).map((item) => item?.result));
}

async function extractViaHiddenTab(url, extractionMode) {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab || typeof tab.id !== "number") {
    throw new Error("백그라운드 탭을 열지 못했습니다.");
  }
  try {
    await waitTabComplete(tab.id);
    await sleep(2500);
    const data = await extractOpenTab(tab.id);
    if (!data || PageExtract.isThinExtract(data)) {
      throw new Error("열린 탭에서 본문을 찾지 못했습니다. 로그인 상태인지 확인해 주세요.");
    }
    data.extractionMode = extractionMode;
    data.markdown = PageExtract.buildMarkdown(data);
    return data;
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (error) {
      // The tab may already have been closed.
    }
  }
}

async function crawlInstagram(inputUrl) {
  const parsed = PageExtract.parseInstagramUrl(inputUrl);
  if (!parsed) {
    throw new Error("인스타그램 URL이 아닙니다. instagram.com/p/코드 또는 프로필 주소를 확인해 주세요.");
  }
  if (parsed.kind === "stories") {
    return extractViaHiddenTab(parsed.canonicalUrl, "instagram-tab");
  }

  let best = null;
  for (const target of PageExtract.instagramFetchTargets(parsed)) {
    try {
      const { html, finalUrl } = await fetchHtml(target.url);
      const data = PageExtract.parseInstagramPage(html, finalUrl, { extractionMode: target.kind });
      data.url = parsed.canonicalUrl;
      if (!best || PageExtract.extractScore(data) > PageExtract.extractScore(best)) {
        best = data;
      }
      if (!PageExtract.isThinExtract(data)) {
        return data;
      }
    } catch (error) {
      // Fetch often hits the login wall; the logged-in tab fallback below is the real path.
    }
  }

  const fromTab = await extractViaHiddenTab(parsed.canonicalUrl, "instagram-tab");
  if (!PageExtract.isThinExtract(fromTab)) {
    return fromTab;
  }
  if (best && !PageExtract.isThinExtract(best)) {
    return best;
  }
  throw new Error("인스타그램 본문을 가져오지 못했습니다. Chrome에서 인스타그램에 로그인한 뒤 다시 시도해 주세요.");
}

async function crawlUrl(inputUrl) {
  if (PageExtract.parseNaverBlogUrl(inputUrl)) {
    return crawlNaverBlog(inputUrl);
  }
  if (PageExtract.parseInstagramUrl(inputUrl)) {
    return crawlInstagram(inputUrl);
  }
  throw new Error("네이버 블로그 또는 인스타그램 URL만 URL로 읽을 수 있습니다.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "OPEN_CHATGPT") {
    openChatGPTAndSend(message)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch(async (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await chrome.storage.local.set({
          lastTransferAt: new Date().toISOString(),
          lastTransferError: errorMessage
        });
        sendResponse({ ok: false, error: errorMessage });
      });
    return true;
  }

  if (message.type === "CRAWL_NAVER" || message.type === "CRAWL_URL") {
    const runner = message.type === "CRAWL_NAVER" ? crawlNaverBlog : crawlUrl;
    runner(message.url)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  return false;
});

(() => {
  if (window.__pageToGptContentScriptInstalled) {
    return;
  }
  window.__pageToGptContentScriptInstalled = true;

  function extractPage() {
    if (!globalThis.PageExtract || typeof globalThis.PageExtract.extractFromWindow !== "function") {
      throw new Error("추출 스크립트가 로드되지 않았습니다.");
    }
    return globalThis.PageExtract.extractFromWindow();
  }

  window.__pageToGptExtract = extractPage;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "EXTRACT_PAGE") {
      return false;
    }

    try {
      sendResponse({ ok: true, data: extractPage() });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  });
})();

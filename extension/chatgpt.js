(() => {
  if (window.__pageToGptChatScriptInstalled) {
    return;
  }
  window.__pageToGptChatScriptInstalled = true;

  const COMPOSER_SELECTORS = [
    "textarea#prompt-textarea",
    "textarea[data-testid=\"text-input\"]",
    "div#prompt-textarea[contenteditable=\"true\"]",
    "div[contenteditable=\"true\"][role=\"textbox\"]",
    "textarea[placeholder]"
  ];

  function isVisible(element) {
    if (!element || element.disabled) {
      return false;
    }
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function findComposer() {
    for (const selector of COMPOSER_SELECTORS) {
      const element = document.querySelector(selector);
      if (isVisible(element)) {
        return element;
      }
    }

    return [...document.querySelectorAll("textarea, [contenteditable=\"true\"]")]
      .find(isVisible) || null;
  }

  function setTextareaValue(element, text) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(element, text);
    } else {
      element.value = text;
    }
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setContentEditableValue(element, text) {
    element.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, text);
    if (!inserted) {
      element.textContent = text;
    }
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: text
    }));
  }

  function fillComposer(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement) {
      setTextareaValue(element, text);
    } else {
      setContentEditableValue(element, text);
    }
  }

  function findSendButton() {
    const explicitSelectors = [
      "button[data-testid=\"send-button\"]",
      "button[aria-label=\"Send prompt\"]",
      "button[aria-label=\"Send message\"]",
      "button[aria-label=\"보내기\"]",
      "form button[type=\"submit\"]"
    ];

    for (const selector of explicitSelectors) {
      const button = document.querySelector(selector);
      if (isVisible(button)) {
        return button;
      }
    }

    return [...document.querySelectorAll("button")].find((button) => {
      if (!isVisible(button)) {
        return false;
      }
      const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.toLowerCase();
      return /send|submit|보내기|전송/.test(label);
    }) || null;
  }

  async function waitForSendButton(timeout = 5_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeout) {
      const button = findSendButton();
      if (button && !button.disabled && button.getAttribute("aria-disabled") !== "true") {
        return button;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }

  async function fillAndSubmit(text, autoSubmit) {
    const composer = findComposer();
    if (!composer) {
      throw new Error("ChatGPT 입력창을 찾지 못했습니다. 로그인 후 다시 시도해 주세요.");
    }

    fillComposer(composer, text);
    if (!autoSubmit) {
      return { sent: false, message: "내용을 입력했습니다. 전송은 하지 않았습니다." };
    }

    const sendButton = await waitForSendButton();
    if (sendButton) {
      sendButton.click();
      return { sent: true, message: "ChatGPT 입력창에 내용을 넣고 전송했습니다." };
    }

    composer.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    return { sent: true, message: "ChatGPT 입력창에 내용을 넣었습니다." };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "FILL_CHATGPT") {
      return false;
    }

    fillAndSubmit(String(message.text || ""), message.autoSubmit !== false)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    return true;
  });
})();

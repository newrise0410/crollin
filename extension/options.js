const autoSubmitInput = document.querySelector("#autoSubmit");
const settingsForm = document.querySelector("#settingsForm");
const openChatButton = document.querySelector("#openChatButton");
const saveStatus = document.querySelector("#saveStatus");

function showStatus(message, isError = false) {
  saveStatus.textContent = message;
  saveStatus.style.color = isError ? "#b43b3b" : "#17835c";
}

async function restoreSettings() {
  const settings = await chrome.storage.local.get({ autoSubmit: true });
  autoSubmitInput.checked = settings.autoSubmit !== false;
}

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await chrome.storage.local.set({ autoSubmit: autoSubmitInput.checked });
    showStatus("설정을 저장했습니다.");
  } catch (error) {
    showStatus(`저장 실패: ${error instanceof Error ? error.message : String(error)}`, true);
  }
});

openChatButton.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "https://chatgpt.com/", active: true });
  } catch (error) {
    showStatus("ChatGPT를 열지 못했습니다.", true);
  }
});

restoreSettings().catch((error) => {
  showStatus(`설정을 불러오지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, true);
});

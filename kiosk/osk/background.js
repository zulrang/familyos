let hideTimer = 0;

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (tabId == null) return;

  if (msg.type === "show") {
    clearTimeout(hideTimer);
    chrome.tabs.sendMessage(
      tabId,
      { type: "render", visible: true, numeric: !!msg.numeric },
      { frameId: 0 },
    );
    return;
  }

  if (msg.type === "hide") {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: "render", visible: false }, { frameId: 0 });
    }, 180);
    return;
  }

  if (msg.type === "key") {
    chrome.tabs.sendMessage(tabId, { type: "insert", key: msg.key });
  }
});

document.getElementById('rescan').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.dispatchEvent(new Event('load'))
    });
    document.getElementById('msg').textContent = 'Rescan triggered.';
    setTimeout(() => (document.getElementById('msg').textContent = ''), 1500);
  };
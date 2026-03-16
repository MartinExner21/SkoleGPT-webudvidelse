// --- STATE MANAGEMENT ---
let searchRequests = {};

// Sørger for at sidepanelet åbner, når man klikker på selve extension-ikonet
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// --- SETUP CONTEXT MENUS ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "forklar-skolegpt",
      title: "Forklar med SkoleGPT",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "oplaes-skolegpt",
      title: "Oplæs med SkoleGPT",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: "opsummer-skolegpt",
      title: "Opsummer hele siden med SkoleGPT",
      contexts: ["page", "frame", "selection"] // Tilføjet selection for at fange PDF-klik
    });
  });
});

// --- MENU CLICK HANDLER ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab.id || tab.url.startsWith("chrome://") || tab.url.startsWith("edge://")) return;

  // 1. Åbn Sidepanelet først, så vi er sikre på det er klar til at modtage besked
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (e) {
    console.log("Kunne ikke åbne sidepanel automatisk. Måske er det allerede åbent.");
  }

  // En lille pause sikrer at sidepanelet er loaded før vi sender beskeden
  setTimeout(() => {
    if (info.menuItemId === "forklar-skolegpt") {
      sendMessageToSidePanel({ action: "start_explanation", selectedText: info.selectionText });
    } 
    else if (info.menuItemId === "oplaes-skolegpt") {
      sendMessageToSidePanel({ action: "read_aloud", text: info.selectionText });
    }
    else if (info.menuItemId === "opsummer-skolegpt") {
      // Vi sender ikke længere pageContent herfra, da vi ikke kan læse PDF'er let her.
      // Sidepanelet beder SkoleGPT om at opsummere baseret på den markerede tekst i stedet
      sendMessageToSidePanel({ action: "start_summary", selectedText: info.selectionText });
    }
  }, 500);
});

// Sender besked bredt - kun sidepanelet lytter nu
function sendMessageToSidePanel(message) {
  chrome.runtime.sendMessage(message).catch(err => {
    console.log("Kunne ikke kontakte sidepanelet. Brugeren skal måske åbne det først.", err);
  });
}

// --- MESSAGE HANDLER (WEB SØGNING) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "perform_web_search") {
    const query = request.query;
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`;
    
    // Åbn ny fane, men behold fokus i nuværende (så sidepanelet forbliver åbent)
    chrome.tabs.create({ url: searchUrl, active: false }, (newTab) => {
      searchRequests[newTab.id] = true;
    });
  }
});

// --- TAB UPDATE LISTENER (Venter på søgning er færdig) ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (searchRequests[tabId] && changeInfo.status === 'complete') {
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: scrapeSearchResults
    }, (results) => {
      if (chrome.runtime.lastError || !results || !results[0]) return;

      const scrapedText = results[0].result;
      
      // Send resultater tilbage til sidepanelet
      sendMessageToSidePanel({
        action: "web_search_results",
        results: scrapedText,
        originalQuery: decodeURIComponent(tab.url.split('q=')[1].split('&')[0])
      });

      delete searchRequests[tabId];
    });
  }
});

// --- SCRAPING FUNCTION (Køres i DDG fanen) ---
function scrapeSearchResults() {
  const results = document.querySelectorAll('article, .react-results-main, .result');
  let extractedText = "";
  let count = 0;
  for (let el of results) {
    if (count >= 5) break;
    const text = el.innerText.replace(/\s+/g, ' ').substring(0, 500);
    if (text.length > 50) {
      extractedText += `Resultat ${count+1}: ${text}\n---\n`;
      count++;
    }
  }
  if (!extractedText) return document.body.innerText.substring(0, 2000);
  return extractedText;
}

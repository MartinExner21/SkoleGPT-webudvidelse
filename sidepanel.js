// --- KONFIGURATION ---
const API_URL = "https://llm.dbc.dk/v1/chat/completions";
const API_KEY = "sk-HbNoj_bjgGvamRXfLl"; 
const MODEL = "skolegpt-v3";

// Fortæl PDF.js hvor worker-filen ligger lokalt
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';

const LEVELS = {
  easy: { label: "Let", prompt: " Svar i et meget let hverdagssprog med korte ord. Det skal være let at læse og let at forstå." },
  medium: { label: "Mellem", prompt: "" },
  hard: { label: "Svær", prompt: " Brug fagord, akademisk sprog, lange ord og inkluder flere detaljer." }
};

let messageHistory = [];
let isListening = false;
let isWebSearchEnabled = false;
let recognition = null;
let currentLevel = localStorage.getItem('sgpt_level') || 'medium';
let isReadingEnabled = localStorage.getItem('sgpt_reading') === 'true';

// DOM Elements
const chatArea = document.getElementById('skolegpt-chat-area');
const inputField = document.getElementById('sgpt-input');
const sendBtn = document.getElementById('sgpt-send');
const micBtn = document.getElementById('sgpt-mic');
const webBtn = document.getElementById('sgpt-web');
const levelBtn = document.getElementById('sgpt-level');
const levelMenu = document.getElementById('skolegpt-level-menu');
const levelOptions = document.querySelectorAll('.sgpt-level-option');
const settingsBtn = document.getElementById('sgpt-settings');
const settingsMenu = document.getElementById('skolegpt-settings-menu');
const toggleReadBtn = document.getElementById('sgpt-toggle-read');
const openAboutBtn = document.getElementById('sgpt-open-about');
const aboutView = document.getElementById('skolegpt-about-view');
const aboutCloseBtn = document.getElementById('sgpt-about-close');

// --- INITIALIZATION ---
function init() {
  updateLevelMenuUI();
  updateReadingMenuUI();
  attachEventListeners();
}

function getSystemPrompt() {
  const basePrompt = "Du er en hjælpsom pædagogisk assistent til skolebrug. Svar altid på dansk.";
  const levelPrompt = LEVELS[currentLevel].prompt;
  return basePrompt + levelPrompt;
}

// --- PDF.JS FUNKTION: Henter op til 10 sider fra PDF'en ---
async function readPdfContent(url, targetText = "") {
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;

    let startPage = 1;

    // Hvis brugeren har markeret tekst, leder vi efter hvilken side den tekst står på
    if (targetText) {
      // Normaliser teksten (fjern mellemrum og gør småt) for at sikre match trods PDF-rod
      const normalizedTarget = targetText.replace(/\s+/g, '').toLowerCase();
      
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // Saml al tekst på siden
        const pageText = textContent.items.map(item => item.str).join('');
        const normalizedPageText = pageText.replace(/\s+/g, '').toLowerCase();
        
        if (normalizedPageText.includes(normalizedTarget)) {
          startPage = i;
          break; // Vi fandt siden! Stop søgningen.
        }
      }
    }

    // Vi læser fra startPage og op til 9 sider mere (maks 10 sider i alt)
    let endPage = Math.min(startPage + 9, numPages);
    let extractedText = "";

    for (let i = startPage; i <= endPage; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      // Sammensæt tekst med rigtige mellemrum til AI'en
      const pageText = textContent.items.map(item => item.str).join(' ');
      extractedText += `[Side ${i}]\n${pageText}\n\n`;
    }

    return extractedText;
  } catch (error) {
    console.error("Fejl ved læsning af PDF:", error);
    return "Fejl: Kunne ikke læse PDF'en automatisk. Dette kan skyldes manglende tilladelser til lokale filer.";
  }
}

// --- Henter teksten fra den aktive fane (HTML eller PDF) ---
async function getActiveTabContent(targetText = "") {
  try {
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return "";
    
    // Tjek om det er en PDF-fil
    if (tab.url.toLowerCase().endsWith('.pdf') || tab.url.includes('.pdf?')) {
      const statusDiv = document.createElement('div');
      statusDiv.className = 'sgpt-status';
      statusDiv.innerText = "📄 Læser PDF-dokument (op til 10 sider)...";
      chatArea.appendChild(statusDiv);
      chatArea.scrollTop = chatArea.scrollHeight;

      const pdfText = await readPdfContent(tab.url, targetText);
      statusDiv.remove(); // Fjern statusbesked når færdig
      return pdfText;
    }

    // Hvis det er en almindelig hjemmeside (HTML)
    let results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body ? document.body.innerText.replace(/\s+/g, ' ').substring(0, 8000) : ""
    });
    
    if (results && results[0] && results[0].result) {
      return results[0].result;
    }
  } catch (e) {
    console.log("Kunne ikke læse fane-indhold automatisk.");
  }
  return "";
}

// --- EVENT LISTENERS ---
function attachEventListeners() {
  webBtn.onclick = () => {
    isWebSearchEnabled = !isWebSearchEnabled;
    webBtn.classList.toggle('active', isWebSearchEnabled);
    webBtn.title = isWebSearchEnabled ? "Websøgning TIL" : "Websøgning FRA";
  };

  levelBtn.onclick = (e) => {
    e.stopPropagation();
    closeAllMenus();
    levelMenu.style.display = 'flex';
  };

  settingsBtn.onclick = (e) => {
    e.stopPropagation();
    const isOpen = settingsMenu.style.display === 'flex';
    closeAllMenus();
    if (!isOpen) settingsMenu.style.display = 'flex';
  };

  levelOptions.forEach(option => {
    option.onclick = () => {
      const newLevel = option.getAttribute('data-level');
      if (newLevel !== currentLevel) {
        currentLevel = newLevel;
        localStorage.setItem('sgpt_level', currentLevel);
        updateLevelMenuUI();
        if (messageHistory.length > 0) regenerateResponseWithNewLevel();
      }
      levelMenu.style.display = 'none';
    };
  });

  toggleReadBtn.onclick = () => {
    isReadingEnabled = !isReadingEnabled;
    localStorage.setItem('sgpt_reading', isReadingEnabled);
    updateReadingMenuUI();
    if (!isReadingEnabled) stopSpeaking();
  };

  openAboutBtn.onclick = () => {
    closeAllMenus();
    aboutView.style.display = 'flex';
  };

  aboutCloseBtn.onclick = () => { aboutView.style.display = 'none'; };

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sgpt-dropdown') && !e.target.closest('.skolegpt-icon-btn')) {
      closeAllMenus();
    }
  });

  function closeAllMenus() {
    levelMenu.style.display = 'none';
    settingsMenu.style.display = 'none';
  }

  sendBtn.onclick = handleUserMessage;
  inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleUserMessage();
  });

  if ('webkitSpeechRecognition' in window) {
    recognition = new webkitSpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'da-DK';
    recognition.onstart = () => { isListening = true; micBtn.classList.add('sgpt-mic-active'); stopSpeaking(); };
    recognition.onend = () => { isListening = false; micBtn.classList.remove('sgpt-mic-active'); };
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
      }
      if (finalTranscript) inputField.value = finalTranscript;
    };
    micBtn.onclick = () => { stopSpeaking(); isListening ? recognition.stop() : recognition.start(); };
  } else { micBtn.style.display = 'none'; }
}

function updateLevelMenuUI() {
  document.querySelectorAll('.sgpt-level-option').forEach(opt => {
    opt.classList.toggle('active', opt.getAttribute('data-level') === currentLevel);
  });
}

function updateReadingMenuUI() {
  toggleReadBtn.classList.toggle('active', isReadingEnabled);
  toggleReadBtn.querySelector('.sgpt-toggle-status').innerText = isReadingEnabled ? "TIL" : "FRA";
}

// --- MESSAGING FRA BACKGROUND SCRIPT ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "web_search_results") {
    handleWebSearchResults(request.results, request.originalQuery);
  } else {
    handleContextMenuAction(request);
  }
});

function handleContextMenuAction(request) {
  chatArea.innerHTML = '';
  
  if (request.action === "read_aloud") {
    stopSpeaking();
    addMessageToUI("user", "Læs op:");
    addMessageToUI("assistant", request.text);
    speakText(request.text, true); 
    return;
  }

  let initialPrompt = "";
  let uiMessage = "";
  let targetTextForPdf = ""; // Gemmes for at PDF.js ved, hvor den skal søge

  if (request.action === "start_explanation") {
    initialPrompt = `Forklar den markerede tekst ekstremt kort og præcist på dansk (maks 2-3 sætninger): "${request.selectedText}"`;
    uiMessage = `Forklar: "${request.selectedText.substring(0, 40)}..."`;
    targetTextForPdf = request.selectedText;
  } 
  else if (request.action === "start_summary") {
    if(request.selectedText){
        initialPrompt = `Lav en ekstremt kort opsummering af denne tekst på dansk (maks 3 hovedpunkter): """${request.selectedText}"""`;
        uiMessage = `Opsummer markering: "${request.selectedText.substring(0, 40)}..."`;
        targetTextForPdf = request.selectedText;
    } else {
        initialPrompt = `Lav en ekstremt kort opsummering af indholdet på dette dokument/hjemmeside på dansk (maks 3 hovedpunkter).`;
        uiMessage = "Opsummer dette dokument";
        targetTextForPdf = ""; // Betyder at PDF.js bare læser fra side 1
    }
  }

  if (initialPrompt) {
    messageHistory = [
      { role: "user", content: initialPrompt }
    ];
    addMessageToUI("user", uiMessage);
    // Vi sender targetText med, så vi ved hvor i PDF'en vi skal starte!
    streamResponse(messageHistory, "", targetTextForPdf);
  }
}

function handleWebSearchResults(results, query) {
  const statusMsgs = chatArea.querySelectorAll('.sgpt-status');
  statusMsgs.forEach(el => el.remove());

  const webContext = `Her er de seneste resultater fra nettet om "${query}":\n${results}`;
  streamResponse(messageHistory, webContext);
}

// --- LOGIK ---
function handleUserMessage() {
  const text = inputField.value.trim();
  if (!text) return;

  stopSpeaking();
  if(chatArea.querySelector('.welcome-msg')) chatArea.innerHTML = '';

  addMessageToUI("user", text);
  inputField.value = '';
  messageHistory.push({ role: "user", content: text });

  if (isWebSearchEnabled) {
    const statusDiv = document.createElement('div');
    statusDiv.className = 'sgpt-status';
    statusDiv.innerText = "🔍 Søger på nettet via DuckDuckGo...";
    chatArea.appendChild(statusDiv);
    chatArea.scrollTop = chatArea.scrollHeight;
    
    chrome.runtime.sendMessage({ action: "perform_web_search", query: text });
  } else {
    streamResponse(messageHistory);
  }
}

function regenerateResponseWithNewLevel() {
  const lastMsg = messageHistory[messageHistory.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    messageHistory.pop();
    if (chatArea.lastElementChild) chatArea.removeChild(chatArea.lastElementChild);
    streamResponse(messageHistory);
  }
}

// -- STREAM RESPONSE (Sender data til SkoleGPT) --
async function streamResponse(messages, extraWebContext = "", targetTextForPdf = "") {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'sgpt-message sgpt-assistant';
  msgDiv.innerText = "Tænker...";
  chatArea.appendChild(msgDiv);
  chatArea.scrollTop = chatArea.scrollHeight;

  // 1. Byg den fulde system prompt
  let sysPrompt = getSystemPrompt();
  
  // 2. Hent automatisk indhold fra den aktive fane (HTML eller PDF)
  // Vi sender 'targetTextForPdf' med ind, så funktionen ved hvilken PDF-side vi kigger på
  const pageContent = await getActiveTabContent(targetTextForPdf);
  
  if (pageContent) {
    sysPrompt += `\n\nHer er indholdet af det aktuelle dokument (maks 10 sider), som brugeren kigger på. Brug dette som kontekst til at forstå spørgsmålet:\n"""${pageContent}"""`;
  }

  if (extraWebContext) {
    sysPrompt += `\n\n${extraWebContext}`;
  }

  const apiMessages = [
    { role: "system", content: sysPrompt },
    ...messages
  ];

  let fullResponse = "";

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}`,
        "Accept": "text/event-stream"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: apiMessages,
        stream: true,
        temperature: 0.5, 
        top_p: 0.95
      })
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    msgDiv.innerText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const json = JSON.parse(line.substring(6));
            const content = json.choices[0]?.delta?.content || "";
            if (content) {
              fullResponse += content;
              msgDiv.innerText = fullResponse;
              chatArea.scrollTop = chatArea.scrollHeight;
            }
          } catch (e) { }
        }
      }
    }
    
    const lastMsg = messageHistory[messageHistory.length - 1];
    if (lastMsg && lastMsg.role !== 'assistant') {
        messageHistory.push({ role: "assistant", content: fullResponse });
    } else if (lastMsg) {
        lastMsg.content = fullResponse;
    }
    
    if (isReadingEnabled) speakText(fullResponse);

  } catch (err) {
    msgDiv.innerText = "Fejl: Kunne ikke forbinde.";
    console.error(err);
  }
}

// --- UI HELPERS ---
function addMessageToUI(role, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `sgpt-message sgpt-${role === 'user' ? 'user' : 'assistant'}`;
  msgDiv.innerText = text;
  chatArea.appendChild(msgDiv);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function speakText(text, force = false) {
  if (!isReadingEnabled && !force) return;
  stopSpeaking();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'da-DK';
  utterance.rate = 1.1;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
}

// Start
init();

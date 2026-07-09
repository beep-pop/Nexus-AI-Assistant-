/* ============================================================
   VEDAM-NEXUS-AI — client logic
   Handles: token gate, voice capture, text input, chat bubbles,
   conversation history, stop button, and audio playback.
   ============================================================ */

(() => {
  "use strict";

  // ---------- Element references ----------
  const gateScreen        = document.getElementById("gate-screen");
  const appScreen         = document.getElementById("app-screen");
  const tokenInput        = document.getElementById("token-input");
  const validateBtn       = document.getElementById("validate-btn");
  const gateError         = document.getElementById("gate-error");

  const chatBox           = document.getElementById("chat-box");
  const thinkingIndicator = document.getElementById("thinking-indicator");
  const micBtn            = document.getElementById("mic-btn");
  const textInput         = document.getElementById("text-input");
  const sendBtn           = document.getElementById("send-btn");
  const statusText        = document.getElementById("status-text");
  const responseAudio     = document.getElementById("response-audio");
  const resetBtn          = document.getElementById("reset-btn");
  const welcomeMessage    = document.getElementById("welcome-message");
  const confirmToast      = document.getElementById("confirm-toast");
  const confirmYesBtn     = document.getElementById("confirm-yes-btn");
  const confirmNoBtn      = document.getElementById("confirm-no-btn");

  // ---------- Session state ----------
  let apiToken = sessionStorage.getItem("librarian_token") || null;

  // Conversation history — only committed after a successful round-trip.
  // Each entry: { role: "user" | "model", text: "..." }
  let conversationHistory = [];

  let currentState = "idle"; // idle | listening | thinking | speaking

  // Web Speech API
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;

  // ============================================================
  // GATE SCREEN
  // ============================================================

  function showGateError(message) {
    gateError.textContent = message;
  }

  function setValidating(isLoading) {
    validateBtn.disabled = isLoading;
    validateBtn.classList.toggle("loading", isLoading);
  }

  async function validateToken() {
    const value = tokenInput.value.trim();
    showGateError("");

    if (!value) {
      showGateError("The card is blank. Please enter your API key.");
      return;
    }

    setValidating(true);
    try {
      const res = await fetch("/validate_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: value }),
      });

      const data = await res.json();

      if (!res.ok || !data.valid) {
        showGateError(data.message || "That key wasn't accepted. Please check it and try again.");
        setValidating(false);
        return;
      }

      apiToken = value;
      sessionStorage.setItem("librarian_token", apiToken);
      enterReadingRoom();
    } catch {
      showGateError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setValidating(false);
    }
  }

  function enterReadingRoom() {
    gateScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    textInput.focus();
  }

  /** Return to gate, wipe token and conversation so nothing leaks across sessions. */
  function goBackToGate(message) {
    sessionStorage.removeItem("librarian_token");
    apiToken = null;
    conversationHistory = [];
    setState("idle");
    appScreen.classList.add("hidden");
    gateScreen.classList.remove("hidden");
    tokenInput.value = "";
    showGateError(message);
  }

  validateBtn.addEventListener("click", validateToken);
  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") validateToken();
  });

  if (apiToken) {
    enterReadingRoom();
  }

  // ============================================================
  // CHAT UI HELPERS
  // ============================================================

  function addBubble(role, text) {
    /* role: "user" | "nexus" */
    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user-row" : "librarian-row"}`;

    const label = document.createElement("div");
    label.className = "bubble-label";

    const labelText = document.createElement("span");
    labelText.textContent = role === "user" ? "You" : "Nexus";  // renamed from Librarian → Nexus
    label.appendChild(labelText);

    const bubble = document.createElement("div");
    bubble.className = `bubble ${role === "user" ? "user-bubble" : "librarian-bubble"}`;
    bubble.textContent = text;   // textContent, never innerHTML — XSS safe

    // Copy button — only on Nexus's replies
    if (role !== "user") {
      label.appendChild(makeCopyButton(text));
    }

    row.appendChild(label);
    row.appendChild(bubble);
    chatBox.appendChild(row);
    scrollToBottom();
    return row;
  }

  /** Builds a small copy-to-clipboard icon button for a reply's text. */
  function makeCopyButton(text) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.setAttribute("aria-label", "Copy reply");
    btn.title = "Copy";
    btn.innerHTML =
      '<svg class="icon-copy" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
        '<path fill="currentColor" d="M8 7V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-3v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4Zm2 0h6a1 1 0 0 1 1 1v9h2V5H10v2ZM5 9v11h9V9H5Z"/>' +
      '</svg>' +
      '<svg class="icon-check" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
        '<path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 20.6 7.4 19.2 6z"/>' +
      '</svg>';

    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(text);
      if (!ok) return;
      btn.classList.add("copied");
      btn.title = "Copied!";
      setTimeout(() => {
        btn.classList.remove("copied");
        btn.title = "Copy";
      }, 1500);
    });

    return btn;
  }

  /** Copies text to the clipboard, with a manual fallback for older browsers. */
  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // fall through to legacy approach
    }
    let helper = null;
    try {
      helper = document.createElement("textarea");
      helper.value = text;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.focus();
      helper.select();
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      if (helper) document.body.removeChild(helper);
    }
  }

  function scrollToBottom() {
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function setStatus(msg) {
    statusText.textContent = msg;
  }

  function setState(state) {
    currentState = state;
    micBtn.classList.remove("listening", "thinking", "speaking");
    if (state !== "idle") micBtn.classList.add(state);
    micBtn.setAttribute("aria-pressed", state === "listening" ? "true" : "false");

    // Update mic button aria-label to reflect current action
    if (state === "speaking") {
      micBtn.setAttribute("aria-label", "Stop speaking");
      micBtn.title = "Tap to stop";
    } else if (state === "listening") {
      micBtn.setAttribute("aria-label", "Stop listening");
      micBtn.title = "Tap to stop";
    } else {
      micBtn.setAttribute("aria-label", "Start speaking");
      micBtn.title = "Tap to speak";
    }

    const busy = state === "thinking"; // only block input while thinking
    sendBtn.disabled = busy;
    textInput.disabled = busy;

    if (state === "thinking") {
      thinkingIndicator.classList.remove("hidden");
    } else {
      thinkingIndicator.classList.add("hidden");
    }
  }

  // ============================================================
  // TEXT INPUT — auto-resize and send on Enter
  // ============================================================

  textInput.addEventListener("input", () => {
    textInput.style.height = "auto";
    textInput.style.height = Math.min(textInput.scrollHeight, 120) + "px";
  });

  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitTextMessage();
    }
  });

  sendBtn.addEventListener("click", () => submitTextMessage());

  function submitTextMessage() {
    const text = textInput.value.trim();
    if (!text || currentState === "thinking") return;

    // If AI is speaking, stop it first then send the new message
    if (currentState === "speaking") {
      stopAudio();
    }

    textInput.value = "";
    textInput.style.height = "auto";
    sendToNexus(text);
  }

  // ============================================================
  // VOICE INPUT
  // ============================================================

  if (!SpeechRecognition) {
    setStatus("Your browser can't listen — try Chrome or Edge for voice input.");
    micBtn.disabled = true;
  } else {
    recognizer = new SpeechRecognition();
    recognizer.lang = "en-US";
    recognizer.continuous = false;
    recognizer.interimResults = false;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = () => {
      setState("listening");
      setStatus("Listening…");
    };

    recognizer.onerror = (event) => {
      setState("idle");
      setStatus("");
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setStatus("Microphone access was blocked — allow it in your browser settings.");
      } else if (event.error === "no-speech") {
        setStatus("Didn't catch that — tap the mic and try again.");
      } else {
        setStatus("Something interrupted the listening. Try again.");
      }
    };

    recognizer.onresult = (event) => {
      const heard = event.results[0][0].transcript.trim();
      if (heard) {
        sendToNexus(heard);
      } else {
        setState("idle");
        setStatus("");
      }
    };

    recognizer.onend = () => {
      if (currentState === "listening") {
        setState("idle");
        setStatus("");
      }
    };
  }

  micBtn.addEventListener("click", () => {
    // ---- STOP button: tap while AI is speaking ----
    if (currentState === "speaking") {
      stopAudio();
      return;
    }

    // ---- Ignore while thinking ----
    if (currentState === "thinking") return;

    // ---- Toggle listening ----
    if (!recognizer) return;
    if (currentState === "listening") {
      recognizer.stop();
      return;
    }

    // idle → start listening
    try {
      recognizer.start();
    } catch {
      // start() throws if called twice too quickly — ignore
    }
  });

  // ============================================================
  // CLEAR / RESET CONVERSATION
  // ============================================================

  function showConfirmToast() {
    confirmToast.classList.add("visible");
  }

  function hideConfirmToast() {
    confirmToast.classList.remove("visible");
  }

  function clearConversation() {
    // Stop anything in flight so nothing lands in a freshly cleared chat.
    if (currentState === "speaking") stopAudio();
    if (currentState === "listening" && recognizer) recognizer.stop();

    conversationHistory = [];
    chatBox.innerHTML = "";
    if (welcomeMessage) chatBox.appendChild(welcomeMessage);

    setState("idle");
    setStatus("Conversation cleared.");
    setTimeout(() => setStatus(""), 2000);
  }

  resetBtn.addEventListener("click", () => {
    // Nothing to clear yet — skip the confirmation dialog.
    if (conversationHistory.length === 0) return;
    showConfirmToast();
  });

  confirmYesBtn.addEventListener("click", () => {
    hideConfirmToast();
    clearConversation();
  });

  confirmNoBtn.addEventListener("click", hideConfirmToast);

  // ============================================================
  // STOP AUDIO
  // ============================================================

  function stopAudio() {
    responseAudio.pause();
    responseAudio.currentTime = 0;
    setState("idle");
    setStatus("");
  }

  // ============================================================
  // BACKEND COMMUNICATION
  // ============================================================

  async function sendToNexus(userText) {
    // Render user bubble immediately so the UI feels responsive.
    const userRow = addBubble("user", userText);
    setState("thinking");
    setStatus("Thinking…");

    try {
      const res = await fetch("/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiToken,
        },
        body: JSON.stringify({
          text: userText,
          history: conversationHistory,
        }),
      });

      if (res.status === 401) {
        userRow.remove();
        goBackToGate("Session expired — please enter your key again.");
        return;
      }

      if (!res.ok) {
        throw new Error("Bad response from server");
      }

      const data = await res.json();

      // Commit to history only after confirmed success.
      conversationHistory.push({ role: "user",  text: userText });
      conversationHistory.push({ role: "model", text: data.text });

      addBubble("nexus", data.text);
      speakReply(data.audio_url);

    } catch {
      userRow.remove();
      setState("idle");
      setStatus("Nexus is unavailable right now — try again.");
    }
  }

  function speakReply(audioUrl) {
    setState("speaking");
    setStatus("Speaking… tap ■ to stop");

    responseAudio.src = audioUrl;

    responseAudio.onended = () => {
      setState("idle");
      setStatus("");
    };

    responseAudio.onerror = () => {
      setState("idle");
      setStatus("Couldn't play that reply — tap the mic or type to continue.");
    };

    responseAudio.play().catch(() => {
      setState("idle");
      setStatus("");
    });
  }

})();

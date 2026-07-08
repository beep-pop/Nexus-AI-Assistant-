/* ============================================================
   THE READING ROOM — client logic
   Handles: token gate, voice capture, text input, chat bubbles,
   conversation history, and audio playback.
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
      showGateError("Couldn't reach the front desk. Check your connection and try again.");
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
    /* role: "user" | "librarian" */
    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user-row" : "librarian-row"}`;

    const label = document.createElement("div");
    label.className = "bubble-label";
    label.textContent = role === "user" ? "You" : "Librarian";

    const bubble = document.createElement("div");
    bubble.className = `bubble ${role === "user" ? "user-bubble" : "librarian-bubble"}`;
    bubble.textContent = text;   // textContent, never innerHTML — XSS safe

    row.appendChild(label);
    row.appendChild(bubble);
    chatBox.appendChild(row);
    scrollToBottom();
    return row;   // return the row so callers can remove it on failure
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

    const busy = state !== "idle";
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
    if (!text || currentState !== "idle") return;
    textInput.value = "";
    textInput.style.height = "auto";
    sendToLibrarian(text);
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
        sendToLibrarian(heard);
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
    if (!recognizer) return;
    if (currentState === "listening") {
      recognizer.stop();
      return;
    }
    if (currentState !== "idle") return;
    try {
      recognizer.start();
    } catch {
      // start() throws if called twice too quickly — ignore
    }
  });

  // ============================================================
  // BACKEND COMMUNICATION
  // ============================================================

  async function sendToLibrarian(userText) {
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
          history: conversationHistory,   // history BEFORE this turn
        }),
      });

      if (res.status === 401) {
        // Remove the optimistic bubble before leaving — the turn never happened.
        userRow.remove();
        goBackToGate("Your card expired — please enter your key again.");
        return;
      }

      if (!res.ok) {
        throw new Error("Bad response from server");
      }

      const data = await res.json();

      // Commit this exchange to history only after confirmed success.
      conversationHistory.push({ role: "user",  text: userText });
      conversationHistory.push({ role: "model", text: data.text });

      addBubble("librarian", data.text);
      speakReply(data.audio_url);

    } catch {
      // Remove the optimistic user bubble — the model never saw it,
      // so the visible transcript and the model context stay in sync.
      userRow.remove();
      setState("idle");
      setStatus("The librarian is momentarily unavailable — try again.");
    }
  }

  function speakReply(audioUrl) {
    setState("speaking");
    setStatus("Speaking…");

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
      // Autoplay blocked by browser policy — text is already in the chat.
      setState("idle");
      setStatus("");
    });
  }

})();

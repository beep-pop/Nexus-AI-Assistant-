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

  // ---------- Session state ----------
  let apiToken = sessionStorage.getItem("librarian_token") || null;
  let conversationHistory = [];
  let currentState = "idle"; // idle | listening | thinking | speaking

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

  if (apiToken) enterReadingRoom();

  // ============================================================
  // CHAT UI HELPERS
  // ============================================================

  function addBubble(role, text) {
    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user-row" : "librarian-row"}`;

    const label = document.createElement("div");
    label.className = "bubble-label";
    label.textContent = role === "user" ? "You" : "Nexus"; // renamed Librarian → Nexus

    const bubble = document.createElement("div");
    bubble.className = `bubble ${role === "user" ? "user-bubble" : "librarian-bubble"}`;
    bubble.textContent = text; // textContent, never innerHTML — XSS safe

    row.appendChild(label);
    row.appendChild(bubble);
    chatBox.appendChild(row);
    scrollToBottom();
    return row;
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

    // Update aria-label and tooltip to match current action
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

    // Only block input while thinking — allow typing/sending while speaking
    const busy = state === "thinking";
    sendBtn.disabled = busy;
    textInput.disabled = busy;

    if (state === "thinking") {
      thinkingIndicator.classList.remove("hidden");
    } else {
      thinkingIndicator.classList.add("hidden");
    }
  }

  // ============================================================
  // TEXT INPUT
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

    // If AI is speaking, stop it first then send
    if (currentState === "speaking") stopAudio();

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
    // ---- STOP: tap while AI is speaking ----
    if (currentState === "speaking") {
      stopAudio();
      return;
    }

    // ---- Ignore while thinking ----
    if (currentState === "thinking") return;

    // ---- Toggle mic ----
    if (!recognizer) return;
    if (currentState === "listening") {
      recognizer.stop();
      return;
    }

    try {
      recognizer.start();
    } catch {
      // start() throws if called too quickly — ignore
    }
  });

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

      if (!res.ok) throw new Error("Bad response from server");

      const data = await res.json();

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

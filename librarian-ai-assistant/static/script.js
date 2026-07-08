/* ============================================================
   THE READING ROOM — client logic
   Handles: token gate validation, voice capture (Web Speech API),
   sending speech to the Flask backend, and playing back the
   librarian's spoken reply. No typing required anywhere.
   ============================================================ */

(() => {
  "use strict";

  // ---------- Element references ----------
  const gateScreen   = document.getElementById("gate-screen");
  const appScreen    = document.getElementById("app-screen");
  const tokenInput   = document.getElementById("token-input");
  const validateBtn  = document.getElementById("validate-btn");
  const gateError    = document.getElementById("gate-error");

  const micBtn       = document.getElementById("mic-btn");
  const statusText   = document.getElementById("status-text");
  const transcriptLog = document.getElementById("transcript-log");
  const responseAudio = document.getElementById("response-audio");

  // ---------- Session state ----------
  // Kept in sessionStorage (cleared when the tab closes) — never localStorage,
  // so the key doesn't linger on a shared computer.
  let apiToken = sessionStorage.getItem("librarian_token") || null;

  // Web Speech API — Chrome/Edge only expose this under the webkit prefix.
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let currentState = "idle"; // idle | listening | thinking | speaking

  // ============================================================
  // GATE SCREEN — token validation
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

      // Success — remember the token for this tab session only.
      apiToken = value;
      sessionStorage.setItem("librarian_token", apiToken);
      enterReadingRoom();
    } catch (err) {
      showGateError("Couldn't reach the front desk. Check your connection and try again.");
    } finally {
      setValidating(false);
    }
  }

  function enterReadingRoom() {
    gateScreen.classList.add("hidden");
    appScreen.classList.remove("hidden");
    setStatus("Tap the light to begin");
  }

  validateBtn.addEventListener("click", validateToken);
  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") validateToken();
  });

  // If a token from an earlier action in this tab is still around, skip the gate.
  if (apiToken) {
    enterReadingRoom();
  }

  // ============================================================
  // VOICE INTERFACE
  // ============================================================

  function setState(state) {
    currentState = state;
    micBtn.classList.remove("listening", "thinking", "speaking");
    if (state !== "idle") micBtn.classList.add(state);
    micBtn.setAttribute("aria-pressed", state === "listening" ? "true" : "false");
  }

  function setStatus(text) {
    statusText.textContent = text;
  }

  function logLine(who, text) {
    const line = document.createElement("span");
    line.className = who; // "you" or "librarian"
    line.textContent = text;
    transcriptLog.appendChild(line);
    transcriptLog.scrollTop = transcriptLog.scrollHeight;
  }

  if (!SpeechRecognition) {
    setStatus("Your browser can't listen — try Chrome or Edge.");
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
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setStatus("Microphone access was blocked — allow it and try again.");
      } else if (event.error === "no-speech") {
        setStatus("Didn't catch that. Tap the light and try again.");
      } else {
        setStatus("Something interrupted the listening. Try again.");
      }
    };

    recognizer.onresult = (event) => {
      const heard = event.results[0][0].transcript.trim();
      if (heard) {
        logLine("you", heard);
        sendToLibrarian(heard);
      } else {
        setState("idle");
        setStatus("Tap the light to begin");
      }
    };

    recognizer.onend = () => {
      // If we're still in "listening" here, no result ever fired — reset.
      if (currentState === "listening") {
        setState("idle");
        setStatus("Tap the light to begin");
      }
    };
  }

  micBtn.addEventListener("click", () => {
    if (!recognizer) return;

    if (currentState === "listening") {
      recognizer.stop();
      return;
    }
    if (currentState !== "idle") return; // busy thinking or speaking

    try {
      recognizer.start();
    } catch (err) {
      // start() throws if called twice in a row too quickly — ignore.
    }
  });

  // ============================================================
  // TALKING TO THE BACKEND
  // ============================================================

  async function sendToLibrarian(spokenText) {
    setState("thinking");
    setStatus("Thinking…");

    try {
      const res = await fetch("/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiToken,
        },
        body: JSON.stringify({ text: spokenText }),
      });

      if (res.status === 401) {
        // Token was rejected mid-session — send back to the gate.
        sessionStorage.removeItem("librarian_token");
        apiToken = null;
        appScreen.classList.add("hidden");
        gateScreen.classList.remove("hidden");
        showGateError("Your card expired. Please enter your key again.");
        setState("idle");
        return;
      }

      if (!res.ok) {
        throw new Error("Bad response from server");
      }

      const data = await res.json();
      logLine("librarian", data.text);
      speakReply(data.audio_url);
    } catch (err) {
      setState("idle");
      setStatus("The librarian is momentarily unavailable. Try again.");
    }
  }

  function speakReply(audioUrl) {
    setState("speaking");
    setStatus("Speaking…");

    responseAudio.src = audioUrl;

    responseAudio.onended = () => {
      setState("idle");
      setStatus("Tap the light to begin");
    };

    responseAudio.onerror = () => {
      setState("idle");
      setStatus("Couldn't play that reply. Tap to try again.");
    };

    responseAudio.play().catch(() => {
      setState("idle");
      setStatus("Tap the light to hear the reply.");
    });
  }
})();

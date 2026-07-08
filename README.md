# Nexus-AI-Assistant-
# The Reading Room — Voice AI Librarian Assistant

A fully voice-controlled AI assistant with a librarian personality.
You speak, it listens, thinks, and speaks its answer back — no typing
required anywhere in the app.

Built as a university project to extend a basic Python + Gemini +
gTTS voice assistant into a full web app with a real UI, a
personality, token-saving logic, and a working login/token gate.

---

## Features

- **Voice in, voice out** — uses the browser's microphone (Web
  Speech API) to hear you, and gTTS to speak every reply back.
- **Real API key check** — the "Enter the Reading Room" screen
  actually validates your Gemini API key with Google before letting
  you in. A fake or random key is rejected.
- **Librarian personality** — every AI answer is written in-character
  as a warm, old-fashioned librarian (see `utils/personality.py`).
- **Token-saving** — simple things like the time, the date, greetings,
  "thank you", and basic math are answered instantly with plain
  Python (`utils/local_answers.py`) and never call the Gemini API.
- **Fast, short replies** — answers are capped at 2–3 sentences since
  they're meant to be heard, not read.

---

## Project structure

"""
THE READING ROOM — Flask backend
Serves the page, validates the user's own Gemini API key, routes
simple questions to plain Python (saving tokens), and sends
everything else to Gemini with a librarian personality — then
speaks the reply back with gTTS.

Multi-turn conversation history is passed in from the client so the
backend stays stateless and sessions are kept in the browser tab.
"""

import os
import time
import uuid
import threading

from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from gtts import gTTS

from utils.local_answers import get_local_answer
from utils.personality import SYSTEM_PROMPT

app = Flask(__name__)

AUDIO_DIR = os.path.join(app.static_folder, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

MODEL_NAME = "gemini-2.5-flash"    # fast + free-tier friendly
AUDIO_MAX_AGE_SECONDS = 60 * 30   # delete generated mp3s older than 30 min
MAX_HISTORY_TURNS = 20             # cap conversation length sent to Gemini
MAX_TEXT_LENGTH = 2000             # max characters per message

# genai.configure() mutates a global SDK client, so concurrent requests
# from different users would otherwise bleed API keys into each other.
# A lock serialises the configure→call block so each key is used atomically.
_genai_lock = threading.Lock()


# ============================================================
# PAGE
# ============================================================

@app.route("/")
def index():
    return render_template("index.html")


# ============================================================
# TOKEN VALIDATION
# ============================================================

@app.route("/validate_token", methods=["POST"])
def validate_token():
    """
    Checks a Gemini API key is real BEFORE letting the user in.
    Uses list_models() instead of generate_content() so a bad key
    is rejected without spending any generation tokens.
    """
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").strip()

    if not token:
        return jsonify(valid=False, message="Please enter a key."), 400

    try:
        with _genai_lock:
            genai.configure(api_key=token)
            models = list(genai.list_models())
        if not models:
            return jsonify(valid=False, message="That key returned no models. Check it's active."), 401
        return jsonify(valid=True)

    except Exception:
        return jsonify(valid=False, message="That key wasn't accepted by Google. Please check it."), 401


# ============================================================
# MAIN CONVERSATION ENDPOINT
# ============================================================

@app.route("/process", methods=["POST"])
def process():
    token = _extract_bearer_token(request)
    if not token:
        return jsonify(message="Missing API key."), 401

    data = request.get_json(silent=True) or {}
    user_text = (data.get("text") or "").strip()
    raw_history = data.get("history")

    if not user_text:
        return jsonify(message="No message received."), 400

    if len(user_text) > MAX_TEXT_LENGTH:
        return jsonify(message="Message is too long — please keep it under 2 000 characters."), 400

    # Validate and sanitise history.
    gemini_history = _parse_history(raw_history)

    # 1) Try to answer with plain Python first — no API call, no tokens spent.
    reply_text = get_local_answer(user_text)

    # 2) Fall back to Gemini for anything not handled locally.
    if reply_text is None:
        try:
            with _genai_lock:
                genai.configure(api_key=token)
                model = genai.GenerativeModel(
                    model_name=MODEL_NAME,
                    system_instruction=SYSTEM_PROMPT,
                )
                chat = model.start_chat(history=gemini_history)
                prompt = (
                    f"{user_text}\n\n"
                    "Answer briefly (2-3 sentences max) since this will also be read aloud."
                )
                response = chat.send_message(prompt)

            reply_text = (response.text or "").strip()
            if not reply_text:
                reply_text = "I'm afraid that one left me speechless. Could you ask again?"

        except Exception as exc:
            exc_str = str(exc)
            if "API_KEY_INVALID" in exc_str or "401" in exc_str or "403" in exc_str:
                return jsonify(message="Your key was rejected."), 401
            reply_text = "The archives are a little slow just now — please try again in a moment."

    # 3) Speak the reply.
    audio_url = _synthesize_speech(reply_text)
    _cleanup_old_audio()

    return jsonify(text=reply_text, audio_url=audio_url)


# ============================================================
# HELPERS
# ============================================================

def _extract_bearer_token(req):
    header = req.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[len("Bearer "):].strip()
    return None


def _parse_history(raw):
    """
    Converts client history (list of {role, text}) into Gemini's
    expected format ({role, parts: [str]}).  Rejects invalid entries
    silently so a bad payload never crashes the route.  Caps turns.
    """
    if not isinstance(raw, list):
        return []

    valid = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        role = entry.get("role")
        text = entry.get("text")
        if role not in ("user", "model"):
            continue
        if not isinstance(text, str) or not text.strip():
            continue
        valid.append({"role": role, "parts": [text[:MAX_TEXT_LENGTH]]})

    # Keep only the most recent N turns to avoid huge context windows.
    # Always keep pairs (user + model) by taking from the end in steps of 2.
    if len(valid) > MAX_HISTORY_TURNS * 2:
        valid = valid[-(MAX_HISTORY_TURNS * 2):]

    return valid


def _synthesize_speech(text):
    filename = f"{uuid.uuid4().hex}.mp3"
    filepath = os.path.join(AUDIO_DIR, filename)
    tts = gTTS(text=text, lang="en")
    tts.save(filepath)
    return f"/static/audio/{filename}"


def _cleanup_old_audio():
    """Deletes mp3s older than AUDIO_MAX_AGE_SECONDS so the folder doesn't grow forever."""
    now = time.time()
    for name in os.listdir(AUDIO_DIR):
        path = os.path.join(AUDIO_DIR, name)
        try:
            if os.path.isfile(path) and now - os.path.getmtime(path) > AUDIO_MAX_AGE_SECONDS:
                os.remove(path)
        except OSError:
            pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)

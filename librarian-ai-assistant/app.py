"""
THE READING ROOM — Flask backend
Serves the page, validates the user's own Gemini API key, routes
simple questions to plain Python (saving tokens), and sends
everything else to Gemini with a librarian personality — then
speaks the reply back with gTTS.
"""

import os
import time
import uuid

from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from gtts import gTTS

from utils.local_answers import get_local_answer
from utils.personality import SYSTEM_PROMPT

app = Flask(__name__)

AUDIO_DIR = os.path.join(app.static_folder, "audio")
os.makedirs(AUDIO_DIR, exist_ok=True)

MODEL_NAME = "gemini-2.5-flash"   # fast + free-tier friendly
AUDIO_MAX_AGE_SECONDS = 60 * 30   # delete generated mp3s older than 30 min


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
        genai.configure(api_key=token)
        # This call authenticates against Google but doesn't run a
        # generation, so it doesn't touch your token/response quota.
        models = list(genai.list_models())
        if not models:
            return jsonify(valid=False, message="That key returned no models. Check it's active."), 401
        return jsonify(valid=True)

    except Exception as exc:
        # Google's client raises different exception types for bad keys,
        # expired keys, network issues, etc. — surface a plain message.
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

    if not user_text:
        return jsonify(message="No speech received."), 400

    # 1) Try to answer with plain Python first — no API call, no tokens spent.
    reply_text = get_local_answer(user_text)

    # 2) Only fall back to Gemini if it's not something simple.
    if reply_text is None:
        try:
            genai.configure(api_key=token)
            model = genai.GenerativeModel(
                model_name=MODEL_NAME,
                system_instruction=SYSTEM_PROMPT,
            )
            prompt = (
                f"{user_text}\n\n"
                "Answer briefly (2-3 sentences max) since this will be read aloud."
            )
            response = model.generate_content(prompt)
            reply_text = (response.text or "").strip()

            if not reply_text:
                reply_text = "I'm afraid that one left me speechless. Could you ask again?"

        except Exception as exc:
            if "API_KEY_INVALID" in str(exc) or "401" in str(exc) or "403" in str(exc):
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
    app.run(debug=True)

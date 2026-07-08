"""
LOCAL ANSWERS — answers simple questions with plain Python.

Anything handled here NEVER touches the Gemini API, so it costs
zero tokens and replies almost instantly. Only things that truly
need "intelligence" should fall through (return None) to the AI.
"""

import re
import datetime
import random

# ------------------------------------------------------------
# Small talk the librarian can handle herself
# ------------------------------------------------------------

GREETING_REPLIES = [
    "Hello there! Welcome to the Reading Room. What can I help you find today?",
    "Good day to you. How may I assist you among the shelves?",
    "Well hello! What brings you to the library today?",
]

THANKS_REPLIES = [
    "You're very welcome. Come back anytime.",
    "My pleasure — that's what I'm here for.",
    "Happy to help. Do let me know if you need anything else.",
]

GOODBYE_REPLIES = [
    "Farewell, and happy reading!",
    "Goodbye! The shelves will be here whenever you return.",
    "Take care — see you next time.",
]

IDENTITY_REPLIES = [
    "I'm your librarian assistant — part guide, part historian, always happy to help you find an answer.",
    "You may call me your librarian. I keep the shelves of knowledge in order, just for you.",
]


def get_local_answer(text):
    """
    Returns a plain-text answer if the question is simple enough to
    handle without the AI, otherwise returns None so the caller
    knows to fall back to Gemini.
    """
    cleaned = text.strip().lower()
    cleaned = re.sub(r"[^\w\s\+\-\*/\.\?']", "", cleaned)  # strip stray punctuation

    if not cleaned:
        return None

    # ---------------- Time ----------------
    if re.search(r"\b(what('s| is)?\s+the\s+)?time\b", cleaned) and "what time" in cleaned or cleaned.strip() in ("time", "whats the time", "what time is it"):
        now = datetime.datetime.now().strftime("%I:%M %p").lstrip("0")
        return f"By my clock, it's currently {now}."

    # ---------------- Date ----------------
    if re.search(r"\b(what('s| is)?\s+(the\s+)?date|what day is it|today'?s date)\b", cleaned):
        today = datetime.datetime.now().strftime("%A, %B %d, %Y")
        return f"Today is {today}."

    # ---------------- Greetings ----------------
    if re.fullmatch(r"(hi|hello|hey|hiya|good morning|good afternoon|good evening)( there)?\.?", cleaned):
        return random.choice(GREETING_REPLIES)

    # ---------------- Thanks ----------------
    if re.search(r"\b(thank you|thanks|thank u)\b", cleaned):
        return random.choice(THANKS_REPLIES)

    # ---------------- Goodbye ----------------
    if re.fullmatch(r"(bye|goodbye|see you|see ya|farewell)\.?", cleaned):
        return random.choice(GOODBYE_REPLIES)

    # ---------------- Identity ----------------
    if re.search(r"\b(who are you|what('s| is) your name)\b", cleaned):
        return random.choice(IDENTITY_REPLIES)

    # ---------------- Simple arithmetic ("what is 5 + 3") ----------------
    math_match = re.fullmatch(
        r"(?:what(?:'s| is)\s+)?(\d+(?:\.\d+)?)\s*([\+\-\*/])\s*(\d+(?:\.\d+)?)\??",
        cleaned,
    )
    if math_match:
        a, op, b = math_match.groups()
        a, b = float(a), float(b)
        try:
            if op == "+":
                result = a + b
            elif op == "-":
                result = a - b
            elif op == "*":
                result = a * b
            elif op == "/":
                if b == 0:
                    return "I can't divide by zero — even the oldest books agree on that."
                result = a / b

            # show whole numbers cleanly (5.0 -> 5)
            if result == int(result):
                result = int(result)
            return f"That comes to {result}."
        except Exception:
            pass  # fall through to Gemini if anything odd happens

    # ---------------- Nothing matched — let Gemini handle it ----------------
    return None

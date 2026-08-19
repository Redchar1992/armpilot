"""Validation helpers for the browser-to-simulator WebSocket protocol.

Keep transport parsing separate from the MuJoCo server so malformed or hostile
client input can be tested without starting a physics runtime.
"""

import json

MAX_COMMAND_CHARS = 500


def origin_is_allowed(origin, allowed_origins):
    """Native clients omit Origin; browser origins must be explicitly allowed."""
    return origin is None or origin in allowed_origins


def parse_client_message(raw):
    """Return a normalized command dict or a user-facing validation error."""
    try:
        message = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None, "malformed message (expected a JSON object)"
    if not isinstance(message, dict):
        return None, "malformed message (expected a JSON object)"

    kind = message.get("type")
    if kind in {"demo", "reset"}:
        return {"type": kind}, None
    if kind == "command":
        text = message.get("text")
        if not isinstance(text, str) or not text.strip():
            return None, "command text must be a non-empty string"
        text = text.strip()
        if len(text) > MAX_COMMAND_CHARS:
            return None, f"command is too long (max {MAX_COMMAND_CHARS} characters)"
        return {"type": kind, "text": text}, None
    return None, f"unknown message type {kind!r}"


import json
import unittest

from armpilot.protocol import MAX_COMMAND_CHARS, origin_is_allowed, parse_client_message


class ProtocolTest(unittest.TestCase):
    def test_browser_origin_must_be_allow_listed(self):
        allowed = {"http://localhost:3100", "https://demo.example"}
        self.assertTrue(origin_is_allowed(None, allowed))
        self.assertTrue(origin_is_allowed("https://demo.example", allowed))
        self.assertFalse(origin_is_allowed("https://evil.example", allowed))

    def test_rejects_invalid_json_and_non_object_payloads(self):
        for raw in ("not-json", "[]", '"command"', "null"):
            message, error = parse_client_message(raw)
            self.assertIsNone(message)
            self.assertIn("JSON object", error)

    def test_normalizes_supported_messages(self):
        self.assertEqual(parse_client_message('{"type":"demo"}'), ({"type": "demo"}, None))
        self.assertEqual(parse_client_message('{"type":"reset","extra":1}'), ({"type": "reset"}, None))
        self.assertEqual(
            parse_client_message(json.dumps({"type": "command", "text": "  pick up red  "})),
            ({"type": "command", "text": "pick up red"}, None),
        )

    def test_rejects_empty_oversized_and_unknown_commands(self):
        _, empty_error = parse_client_message('{"type":"command","text":"  "}')
        self.assertIn("non-empty", empty_error)
        _, long_error = parse_client_message(json.dumps({
            "type": "command",
            "text": "x" * (MAX_COMMAND_CHARS + 1),
        }))
        self.assertIn("too long", long_error)
        _, unknown_error = parse_client_message('{"type":"launch"}')
        self.assertIn("unknown message type", unknown_error)


if __name__ == "__main__":
    unittest.main()

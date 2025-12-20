#!/usr/bin/env python3
"""
Bash check hook - commit hygiene reminders.
"""
import json
import sys

try:
    data = json.load(sys.stdin)
    cmd = data.get("tool_input", {}).get("command", "")

    if "git commit" in cmd:
        print("=== COMMIT STYLE ===")
        print("- Single line, imperative mood, ~50 chars")
        print("- NO AI attribution, NO co-author, NO emoji")
        print("- Write it like a human developer would")
        print("- Example: 'Add dark mode toggle to settings'")

        if "Generated with" in cmd or "Co-Authored-By" in cmd:
            print("")
            print("WARNING: AI attribution detected - remove it!")

    if "git push" in cmd:
        print("-> Did you run `npm run harness`?")
except Exception:
    pass

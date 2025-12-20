#!/usr/bin/env python3
"""
Session start hook - shows checklist and active beads issues.
"""
import subprocess
import json

print("=== SESSION START ===")
print("- For non-trivial work: Read SYSTEM_DESIGN.md first")
print("- Check beads for related/blocking issues")
print("- Confirm understanding before writing code")
print("- If unclear, ask questions first")
print()

# Try to show active beads issues
try:
    result = subprocess.run(
        ["bd", "list", "--status", "in_progress", "--json"],
        capture_output=True,
        text=True,
        timeout=5
    )
    if result.returncode == 0 and result.stdout.strip():
        issues = json.loads(result.stdout)
        if issues:
            print("=== ACTIVE WORK (in_progress) ===")
            for issue in issues[:5]:  # Show max 5
                print(f"  [{issue.get('id', '?')}] {issue.get('title', 'Untitled')}")
            print()
except Exception:
    pass

# Try to show ready issues
try:
    result = subprocess.run(
        ["bd", "ready", "--limit", "3", "--json"],
        capture_output=True,
        text=True,
        timeout=5
    )
    if result.returncode == 0 and result.stdout.strip():
        issues = json.loads(result.stdout)
        if issues:
            print("=== READY TO WORK (no blockers) ===")
            for issue in issues[:3]:
                print(f"  [{issue.get('id', '?')}] {issue.get('title', 'Untitled')}")
            print()
except Exception:
    pass

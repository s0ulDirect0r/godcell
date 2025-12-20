#!/usr/bin/env python3
"""
Pre-compact hook - remind to leave context for next session.
"""
import json
import sys
from datetime import datetime

print()
print("=== COMPACTION IMMINENT ===")
print()
print("Before context is compacted, ensure:")
print()
print("1. Work state is saved:")
print("   - Update beads issues with current status")
print("   - If work is incomplete, note what's left")
print()
print("2. Handoff notes (in worklogs/):")
print("   - What changed")
print("   - What surprised you")
print("   - What to remember")
print()
print("3. No hanging state:")
print("   - Uncommitted changes? Commit or stash")
print("   - Failing tests? Create a beads issue")
print()
print(f"Suggested worklog file: worklogs/{datetime.now().strftime('%Y-%m-%d')}.md")
print()

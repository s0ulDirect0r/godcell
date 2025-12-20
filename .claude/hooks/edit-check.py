#!/usr/bin/env python3
"""
Edit/Write check hook - remind to test after code changes.
"""
import json
import sys

try:
    data = json.load(sys.stdin)
    tool_input = data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    # Check if this is a code file (not config, not docs)
    code_extensions = [".ts", ".tsx", ".js", ".jsx", ".py"]
    is_code = any(file_path.endswith(ext) for ext in code_extensions)

    # Skip test files themselves
    is_test = ".test." in file_path or "__tests__" in file_path or ".spec." in file_path

    # Skip config and docs
    skip_patterns = ["package.json", "tsconfig", ".md", ".txt", ".json", ".yml", ".yaml"]
    is_config = any(p in file_path for p in skip_patterns)

    if is_code and not is_test and not is_config:
        print("-> Code modified. Remember to verify:")
        print("   - Run relevant tests or `npm run harness`")
        print("   - Check for type errors")
        print("   - Test the actual behavior if it's visual/runtime")

except Exception:
    pass

# Phase 8: Remove Phaser

**Estimated Time:** 1 hour
**Dependencies:** Phase 7 (HUD/DOM Overlay) must be complete

## Overview

Delete Phaser dependencies, rendering code, and adapter. Three.js is now the only renderer. Simplify codebase by removing renderer flags and always using ThreeRenderer.

## Goals

1. Remove Phaser from package.json
2. Delete `PhaserRenderer.ts` and related code
3. Remove renderer mode flags (no longer needed)
4. Always use ThreeRenderer
5. Verify build passes and game works

## Files to Delete

```bash
# Delete Phaser adapter
rm client/src/render/phaser/PhaserRenderer.ts
rmdir client/src/render/phaser/

# Delete old GameScene (if not already deleted in Phase 4)
rm client/src/scenes/GameScene.ts
rmdir client/src/scenes/

# Simplify flags (optional - can delete entirely)
rm client/src/config/renderer-flags.ts
```

## Files to Modify

### `client/package.json`

Remove Phaser dependency.

**Before:**

```json
{
  "dependencies": {
    "@godcell/shared": "*",
    "phaser": "^3.80.1",
    "socket.io-client": "^4.7.2",
    "three": "^0.160.0"
  }
}
```

**After:**

```json
{
  "dependencies": {
    "@godcell/shared": "*",
    "socket.io-client": "^4.7.2",
    "three": "^0.160.0"
  }
}
```

### `client/src/main.ts`

Always use ThreeRenderer (no flag logic).

**Before:**

```typescript
import { PhaserRenderer } from './render/phaser/PhaserRenderer';
import { ThreeRenderer } from './render/three/ThreeRenderer';
import type { Renderer } from './render/Renderer';
import { getRendererFlags } from './config/renderer-flags';

const flags = getRendererFlags();

let renderer: Renderer;
if (flags.mode === 'three-only') {
  renderer = new ThreeRenderer();
} else {
  renderer = new PhaserRenderer();
}
```

**After:**

```typescript
import { ThreeRenderer } from './render/three/ThreeRenderer';

// Always use Three.js renderer
const renderer = new ThreeRenderer();
```

### `client/src/utils/performance.ts` (Optional cleanup)

Remove renderer mode from debug overlay if it's no longer relevant.

### `client/src/ui/DebugOverlay.ts` (Optional cleanup)

Remove "Renderer: X" line from debug output.

## Test Cases

### Build Test

```bash
# Clean install
rm -rf client/node_modules
npm install

# Verify Phaser not installed
npm list phaser
# Should error: "phaser@* extraneous"

# Build
npm run build
# Should succeed without errors
```

### Runtime Test

```bash
npm run dev
# Open: http://localhost:8080

# Verify:
# - Game loads (Three.js renderer)
# - All entities render correctly
# - Movement, collection, death/respawn work
# - HUD displays correctly
# - No console errors
# - No Phaser references in console
```

### Bundle Size Check

```bash
npm run build
ls -lh client/dist/*.js

# Compare to Phase 0 baseline
# Should be significantly smaller (Phaser was ~3MB minified)
```

## Acceptance Criteria

- [ ] Phaser removed from package.json
- [ ] `npm install` succeeds
- [ ] `npm run build` succeeds
- [ ] Game works identically to Phase 7
- [ ] No Phaser references in code
- [ ] No Phaser console logs
- [ ] Bundle size reduced (~3MB smaller)
- [ ] All tests still pass

## Implementation Notes

**Gotchas:**

- Make sure no imports reference `phaser` anywhere
- Check for stray Phaser types in interfaces
- Remove `@types/phaser` from devDependencies too

**Verification:**

```bash
# Search for any remaining Phaser references
grep -r "phaser" client/src/
grep -r "Phaser" client/src/

# Should return no results (except maybe comments)
```

**Bundle analysis:**

```bash
# Optional: Check bundle contents
npx vite-bundle-visualizer
# Phaser should not appear in the bundle
```

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Add phaser back to package.json
# 2. Restore PhaserRenderer files
# 3. Restore renderer flag logic in main.ts
# 4. npm install
```

## Next Phase

Once this phase is approved, proceed to **Phase 9: Polish**.

**Congratulations!** At this point, the migration is functionally complete. Phase 9 is about making it look better.

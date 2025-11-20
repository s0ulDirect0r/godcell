# Performance Baseline - Phase 0

**Date:** 2025-11-20
**Branch:** phase-0-three-js
**Hardware:** [To be filled]

## Phaser-Only Baseline

Captured after 10 seconds of gameplay with `?baseline` flag.

### Performance Metrics

- **FPS:** 46
- **Frame Time:** 21.94ms
- **Memory Usage:** 134.0MB

### Test Conditions

- **Players:** 1 human + 15 AI bots
- **Nutrients:** 26 active
- **Obstacles:** 12 gravity distortions
- **Swarms:** 18 entropy swarms
- **World Size:** 4800x3200px
- **Viewport:** 1200x800px

### Testing URLs

```bash
# Phaser-only mode (default)
http://localhost:8080

# Phaser-only with debug overlay
http://localhost:8080?debug

# Phaser-only with baseline capture
http://localhost:8080?baseline

# All flags together
http://localhost:8080?renderer=phaser-only&debug&baseline
```

## Notes

- FPS is below 60 due to game complexity (15 bots, 18 swarms, particles, trails)
- This establishes our real-world baseline for comparison
- Debug overlay adds negligible overhead
- Memory measurements are Chrome-specific (performance.memory API)

## Future Comparisons

This baseline will be compared against:
- **Phase 5:** Three.js proof-of-concept (nutrients only)
- **Phase 6:** Full Three.js entity rendering
- **Phase 9:** Final polished Three.js renderer

**Target:** Maintain FPS within 5% of baseline (44-48 FPS), memory within 20% (<161MB).

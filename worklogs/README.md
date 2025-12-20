# Worklogs

Brief notes after completing work. 2-3 sentences max.

## Format

```
## YYYY-MM-DD - [brief topic]

What changed:
What surprised me:
What to remember:
```

## Example

```
## 2025-01-15 - EMP range fix

What changed: Fixed EMP stunning players outside its range. The collision check was using center-to-center instead of edge-to-edge.
What surprised me: The GAME_CONFIG.EMP_RANGE hadn't been updated when player radii changed.
What to remember: Collision checks need to account for both entity radii.
```

## Why

- Helps future sessions pick up context quickly
- Surfaces patterns across work sessions
- Lightweight - don't overthink it

# ECS Quick Reference

Cheat sheet for components, tags, and abilities.

---

## Components by Category

### Core (all entities)

| Component | Fields | Used By |
|-----------|--------|---------|
| `Position` | `x, y` | All entities |
| `Velocity` | `x, y` (px/s) | Players, Swarms, Pseudopods |
| `Energy` | `current, max` | Players, Swarms (when disabled) |

### Player-Specific

| Component | Fields | Purpose |
|-----------|--------|---------|
| `Player` | `socketId, name, color` | Identity (immutable) |
| `Stage` | `stage, isEvolving, evolvingUntil?` | Evolution state |
| `Input` | `direction: {x, y}` | Movement intent |
| `Sprint` | `isSprinting` | Sprint state |
| `Stunned` | `until` (timestamp) | EMP stun effect |
| `Cooldowns` | `lastEMPTime?, lastPseudopodTime?` | Ability cooldowns |
| `DamageTracking` | `lastDamageSource?, lastBeamShooter?, activeDamage[]` | Death cause, kill credit |
| `DrainTarget` | `predatorId` | Being drained by multi-cell |

### Entity Types

| Component | Fields | Purpose |
|-----------|--------|---------|
| `Nutrient` | `value, capacityIncrease, valueMultiplier, isHighValue` | Food pickup |
| `Obstacle` | `radius, strength` | Gravity well |
| `Swarm` | `size, state, targetPlayerId?, patrolTarget?, homePosition, disabledUntil?, beingConsumedBy?` | Entropy enemy |
| `Pseudopod` | `ownerId, ownerSocketId, width, maxDistance, distanceTraveled, color, hitEntities` | Lightning beam |

### Client-Only

| Component | Fields | Purpose |
|-----------|--------|---------|
| `InterpolationTarget` | `targetX, targetY, timestamp` | Smooth movement |
| `ClientDamageInfo` | `totalDamageRate, primarySource, proximityFactor?` | Damage aura rendering |

---

## Ability Components

Presence = ability unlocked. Most are pure markers (no data), except `CanDetect`.

| Component | Stage | Data | Effect |
|-----------|-------|------|--------|
| `CanFireEMP` | 2+ | — | EMP pulse (stuns nearby, drains energy) |
| `CanFirePseudopod` | 2+ | — | Lightning beam projectile |
| `CanEngulf` | 2+ | — | Contact predation on smaller entities |
| `CanDetect` | 2+ | `radius: number` | Chemical sensing within radius |
| `CanSprint` | 3+ | — | Speed boost (energy cost) |

---

## Tags

### Entity Classification

| Tag | Purpose |
|-----|---------|
| `Player` | Human or bot player |
| `Bot` | AI-controlled player |
| `Nutrient` | Food entity |
| `Obstacle` | Gravity well |
| `Swarm` | Entropy enemy |
| `Pseudopod` | Lightning beam |
| `LocalPlayer` | (Client only) This client's player |

### Transient (cleared each tick)

| Tag | Purpose |
|-----|---------|
| `SlowedThisTick` | Movement debuff active |
| `DamagedThisTick` | Took damage this tick |

---

## Evolution Stage Progression

| Stage | Name | Abilities Unlocked |
|-------|------|-------------------|
| 1 | Single-Cell | None |
| 2 | Multi-Cell | EMP, Pseudopod, Engulf, Detect |
| 3 | Cyber-Organism | Sprint |
| 4 | Humanoid | (Not implemented) |
| 5 | Godcell | (Not implemented) |

---

## Quick Lookups

```typescript
// Query by tag
world.forEachWithTag(Tags.Player, (entity) => { ... })

// Query by components
world.query(Components.Position, Components.Velocity)

// Get component
const pos = world.getComponent(entity, Components.Position)

// Check ability
if (world.hasComponent(entity, Components.CanFireEMP)) { ... }

// Entity ↔ Socket ID (server)
getEntityBySocketId(socketId)
getSocketIdByEntity(entity)

// Entity ↔ String ID (server)
getEntityByStringId('nutrient_5')
getStringIdByEntity(entity)
```

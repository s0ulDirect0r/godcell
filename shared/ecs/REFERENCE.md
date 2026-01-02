# ECS Quick Reference

Cheat sheet for components, tags, and abilities. Last updated: Jan 2, 2026.

---

## Components by Category

### Core (all entities)

| Component  | Fields              | Used By                         |
| ---------- | ------------------- | ------------------------------- |
| `Position` | `x, y, z?`          | All entities (z for Stage 5)    |
| `Velocity` | `x, y, z?` (px/s)   | Players, Swarms, Pseudopods     |
| `Energy`   | `current, max`      | Players, Swarms (when disabled) |

### Player-Specific

| Component               | Fields                                                         | Purpose                      |
| ----------------------- | -------------------------------------------------------------- | ---------------------------- |
| `Player`                | `socketId, name, color`                                        | Identity (immutable)         |
| `Stage`                 | `stage, isEvolving, evolvingUntil?, radius`                    | Evolution state              |
| `Input`                 | `direction: {x, y, z?}`                                        | Movement intent (z for S5)   |
| `Sprint`                | `isSprinting`                                                  | Sprint state                 |
| `Stunned`               | `until` (timestamp)                                            | EMP/trap stun effect         |
| `SpawnImmunity`         | `until` (timestamp)                                            | Post-respawn immunity        |
| `Cooldowns`             | `lastEMPTime?, lastPseudopodTime?, lastMelee*?, lastTrap*?`    | Ability cooldowns            |
| `DamageTracking`        | `lastDamageSource?, lastBeamShooter?, activeDamage[]`          | Death cause, kill credit     |
| `DrainTarget`           | `predatorId`                                                   | Being drained by multi-cell  |
| `CombatSpecialization`  | `specialization, selectionPending, selectionDeadline?`         | Stage 3 combat path          |
| `Knockback`             | `forceX, forceY, decayRate`                                    | Applied melee force          |
| `CameraFacing`          | `yaw, pitch`                                                   | Stage 5 flight input         |

### Entity Types

| Component         | Fields                                                          | Purpose              |
| ----------------- | --------------------------------------------------------------- | -------------------- |
| `Nutrient`        | `value, capacityIncrease, valueMultiplier, isHighValue`         | Food pickup (S1-2)   |
| `Obstacle`        | `radius, strength`                                              | Gravity well         |
| `Swarm`           | `size, state, targetPlayerId?, homePosition, disabledUntil?`    | Entropy enemy        |
| `Pseudopod`       | `ownerId, ownerSocketId, width, maxDistance, color, hitEntities`| Lightning beam       |
| `Tree`            | `radius, height, variant`                                       | Jungle tree (S3+)    |
| `DataFruit`       | `treeEntityId, value, capacityIncrease, ripeness, fallenAt?`    | Harvestable fruit    |
| `CyberBug`        | `swarmId, size, state, fleeingFrom?, value, capacityIncrease`   | Skittish prey (S3+)  |
| `JungleCreature`  | `variant, size, state, targetEntityId?, value, capacityIncrease`| NPC fauna (S3+)      |
| `EntropySerpent`  | `size, state, targetEntityId?, homePosition, heading`           | Apex predator (S3+)  |
| `Projectile`      | `ownerId, damage, capacitySteal, speed, state, color`           | Ranged spec attack   |
| `Trap`            | `ownerId, damage, stunDuration, triggerRadius, lifetime, color` | Traps spec mine      |

### Server-Only

| Component           | Fields                                              | Purpose                   |
| ------------------- | --------------------------------------------------- | ------------------------- |
| `PendingRespawn`    | `respawnAt, entityType, stage?, position?, metadata`| Deferred entity spawn     |
| `AbilityIntent`     | `abilityType, targetX?, targetY?, meleeAttackType?` | Tick-based ability exec   |
| `PendingExpiration` | `expiresAt`                                         | Deferred entity cleanup   |

### Sphere Mode

| Component       | Fields                              | Purpose                    |
| --------------- | ----------------------------------- | -------------------------- |
| `SphereContext` | `surfaceRadius, isInnerSurface`     | Sphere surface binding     |
| `Intangible`    | —                                   | Phase shift (pass spheres) |

### Client-Only

| Component             | Fields                                             | Purpose               |
| --------------------- | -------------------------------------------------- | --------------------- |
| `InterpolationTarget` | `targetX, targetY, targetZ?, timestamp`            | Smooth movement       |
| `ClientDamageInfo`    | `totalDamageRate, primarySource, proximityFactor?` | Damage aura rendering |

---

## Ability Components

Presence = ability unlocked. Most are pure markers (no data), except `CanDetect`.

| Component          | Stage | Data             | Effect                                  |
| ------------------ | ----- | ---------------- | --------------------------------------- |
| `CanFireEMP`       | 2+    | —                | EMP pulse (stuns nearby, drains energy) |
| `CanFirePseudopod` | 2+    | —                | Lightning beam projectile               |
| `CanEngulf`        | 2+    | —                | Contact predation on smaller entities   |
| `CanDetect`        | 2+    | `radius: number` | Chemical sensing within radius          |
| `CanSprint`        | 3+    | —                | Speed boost (energy cost)               |

---

## Tags

### Entity Classification

| Tag               | Purpose                            |
| ----------------- | ---------------------------------- |
| `Player`          | Human or bot player                |
| `Bot`             | AI-controlled player               |
| `Nutrient`        | Food entity (Stage 1-2)            |
| `Obstacle`        | Gravity well                       |
| `Swarm`           | Entropy enemy                      |
| `Pseudopod`       | Lightning beam                     |
| `Tree`            | Digital jungle tree (Stage 3+)     |
| `DataFruit`       | Harvestable fruit (Stage 3+)       |
| `CyberBug`        | Skittish prey bug (Stage 3+)       |
| `JungleCreature`  | NPC fauna (Stage 3+)               |
| `EntropySerpent`  | Apex predator (Stage 3+)           |
| `Projectile`      | Ranged spec projectile             |
| `Trap`            | Traps spec mine                    |
| `LocalPlayer`     | (Client only) This client's player |

### Transient (cleared each tick)

| Tag               | Purpose                |
| ----------------- | ---------------------- |
| `SlowedThisTick`  | Movement debuff active |
| `DamagedThisTick` | Took damage this tick  |

---

## Evolution Stage Progression

| Stage | Name           | Threshold | Abilities Unlocked                           |
| ----- | -------------- | --------- | -------------------------------------------- |
| 1     | Single-Cell    | 0         | Basic movement                               |
| 2     | Multi-Cell     | 300       | EMP, Pseudopod, Engulf, Detect               |
| 3     | Cyber-Organism | 3,000     | Sprint + Combat Spec (melee/ranged/traps)    |
| 4     | Humanoid       | 30,000    | First-person camera                          |
| 5     | Godcell        | 100,000   | 3D flight (Q/E), Phase shift                 |

### Stage 3 Combat Specializations

| Specialization | Attack       | Key Input              |
| -------------- | ------------ | ---------------------- |
| Melee          | Swipe/Thrust | LMB (swipe), RMB (thrust) |
| Ranged         | Projectile   | LMB (fire at cursor)   |
| Traps          | Mine         | RMB (place at cursor)  |

### Stage 5 Flight Controls

| Input | Action                              |
| ----- | ----------------------------------- |
| WASD  | Movement relative to camera         |
| Q     | Ascend                              |
| E     | Descend                             |
| Shift | Phase shift (pass through spheres)  |

---

## World Spheres

| Sphere   | Radius | Surface       | Stages |
| -------- | ------ | ------------- | ------ |
| Soup     | 2,448  | Outer         | 1-2    |
| Jungle   | 9,792  | Inner (4x)    | 3+     |
| God      | 29,376 | Outer (12x)   | 5      |

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

# Phase 7: HUD/DOM Overlay

**Estimated Time:** 1-2 hours
**Dependencies:** Phase 6 (Entity Migrations) must be complete

## Overview

Move HUD (health/energy bars, countdown timer, death overlay) from Phaser rendering to DOM-based overlay. This decouples UI from the renderer and makes it renderer-agnostic.

## Goals

1. Create DOM-based HUD overlay
2. Health and energy bars
3. Countdown timer
4. Death overlay with respawn button
5. Update HUD every frame from GameState
6. Remove Phaser UI rendering code

## Files to Create

### `client/src/render/hud/HUDOverlay.ts`

```typescript
import type { GameState } from '../../core/state/GameState';
import { eventBus } from '../../core/events/EventBus';

export class HUDOverlay {
  private container: HTMLDivElement;
  private healthBarFill!: HTMLDivElement;
  private energyBarFill!: HTMLDivElement;
  private countdown!: HTMLDivElement;
  private deathOverlay!: HTMLDivElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'hud-overlay';
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
      font-family: monospace;
    `;
    document.body.appendChild(this.container);

    this.createBars();
    this.createCountdown();
    this.createDeathOverlay();

    // Subscribe to death events
    eventBus.on('player:died', this.showDeathOverlay.bind(this));
    eventBus.on('player:respawned', this.hideDeathOverlay.bind(this));
  }

  private createBars(): void {
    const barsContainer = document.createElement('div');
    barsContainer.style.cssText = `
      position: absolute;
      top: 20px;
      left: 20px;
      width: 200px;
    `;

    // Health bar
    const healthBarBg = document.createElement('div');
    healthBarBg.style.cssText = `
      width: 100%;
      height: 20px;
      background: rgba(255, 0, 0, 0.3);
      border: 2px solid #ff0000;
      margin-bottom: 10px;
    `;
    this.healthBarFill = document.createElement('div');
    this.healthBarFill.style.cssText = `
      width: 100%;
      height: 100%;
      background: #ff0000;
      transition: width 0.1s;
    `;
    healthBarBg.appendChild(this.healthBarFill);

    // Energy bar
    const energyBarBg = document.createElement('div');
    energyBarBg.style.cssText = `
      width: 100%;
      height: 20px;
      background: rgba(0, 255, 255, 0.3);
      border: 2px solid #00ffff;
    `;
    this.energyBarFill = document.createElement('div');
    this.energyBarFill.style.cssText = `
      width: 100%;
      height: 100%;
      background: #00ffff;
      transition: width 0.1s;
    `;
    energyBarBg.appendChild(this.energyBarFill);

    barsContainer.appendChild(healthBarBg);
    barsContainer.appendChild(energyBarBg);
    this.container.appendChild(barsContainer);
  }

  private createCountdown(): void {
    this.countdown = document.createElement('div');
    this.countdown.style.cssText = `
      position: absolute;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 24px;
      color: #00ffff;
      text-shadow: 0 0 10px #00ffff;
      font-family: monospace;
    `;
    this.container.appendChild(this.countdown);
  }

  private createDeathOverlay(): void {
    this.deathOverlay = document.createElement('div');
    this.deathOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      display: none;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      pointer-events: auto;
    `;

    const title = document.createElement('div');
    title.textContent = 'You have diluted into the digital ocean';
    title.style.cssText = `
      font-size: 32px;
      color: #ff0000;
      margin-bottom: 20px;
    `;

    const respawnButton = document.createElement('button');
    respawnButton.textContent = 'Respawn (R)';
    respawnButton.style.cssText = `
      font-size: 24px;
      padding: 10px 30px;
      background: #00ffff;
      color: #000;
      border: none;
      cursor: pointer;
      font-family: monospace;
    `;
    respawnButton.onclick = () => {
      eventBus.emit('input:respawn');
    };

    this.deathOverlay.appendChild(title);
    this.deathOverlay.appendChild(respawnButton);
    this.container.appendChild(this.deathOverlay);
  }

  /**
   * Update HUD from current game state
   * Call this every frame
   */
  update(state: GameState): void {
    const myPlayer = state.getMyPlayer();
    if (!myPlayer) return;

    // Update health bar
    const healthPercent = (myPlayer.health / myPlayer.maxHealth) * 100;
    this.healthBarFill.style.width = `${healthPercent}%`;

    // Update energy bar
    const energyPercent = (myPlayer.energy / myPlayer.maxEnergy) * 100;
    this.energyBarFill.style.width = `${energyPercent}%`;

    // Update countdown (time until starvation)
    const secondsLeft = Math.ceil(myPlayer.energy / 2.66); // Decay rate from GAME_CONFIG
    this.countdown.textContent = `${secondsLeft}s`;

    // Color changes when low
    if (secondsLeft < 15) {
      this.countdown.style.color = '#ff0000';
    } else if (secondsLeft < 30) {
      this.countdown.style.color = '#ffff00';
    } else {
      this.countdown.style.color = '#00ffff';
    }
  }

  private showDeathOverlay(): void {
    this.deathOverlay.style.display = 'flex';
  }

  private hideDeathOverlay(): void {
    this.deathOverlay.style.display = 'none';
  }

  /**
   * Clean up
   */
  dispose(): void {
    this.container.remove();
  }
}
```

## Files to Modify

### `client/src/main.ts`

Add HUD overlay to bootstrap.

```typescript
import { HUDOverlay } from './render/hud/HUDOverlay';

// ... after renderer init

const hudOverlay = new HUDOverlay();

// In update loop:
function update(): void {
  // ... existing code

  hudOverlay.update(gameState); // NEW

  requestAnimationFrame(update);
}
```

## Test Cases

### Manual Testing

```bash
npm run dev
# Open: http://localhost:8080

# Verify:
# - Health bar (red) visible top-left
# - Energy bar (cyan) visible top-left
# - Countdown timer visible center-top
# - Bars update as you collect nutrients
# - Countdown decreases over time
# - Countdown turns yellow (<30s), red (<15s)

# Test death overlay:
# - Let energy reach 0
# - Death overlay appears
# - "Respawn" button visible and clickable
# - R key also respawns
# - Overlay disappears after respawn
```

## Acceptance Criteria

- [ ] HUD renders as DOM overlay (not Phaser)
- [ ] Health bar updates correctly
- [ ] Energy bar updates correctly
- [ ] Countdown timer accurate and color-coded
- [ ] Death overlay shows on death
- [ ] Respawn button works (both click and R key)
- [ ] No layout thrash (smooth 60fps)
- [ ] Works in both phaser-only and three-only modes
- [ ] Phaser UI rendering code removed

## Implementation Notes

**Gotchas:**

- Set `pointer-events: none` on HUD container except death overlay
- Use CSS transitions for smooth bar animations
- Avoid layout recalculations every frame (cache dimensions)
- Respawn button must emit `input:respawn` event (not call SocketManager directly)

**Performance:**

- Updating `style.width` is cheap (GPU-accelerated)
- Use `transform` instead of `top`/`left` for positioning if animating
- Death overlay should be `display: none` when hidden (not just opacity)

**Styling:**

- Colors match game aesthetic (cyan, red, neon)
- Monospace font for digital feel
- Text shadows for glow effect

## Rollback Instructions

```bash
git revert HEAD

# Or manually:
# 1. Delete client/src/render/hud/HUDOverlay.ts
# 2. Revert client/src/main.ts
# 3. Re-enable Phaser UI rendering (if needed)
```

## Next Phase

Once this phase is approved, proceed to **Phase 8: Remove Phaser**.

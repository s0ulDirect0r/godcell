/**
 * HUD overlay - displays health, energy, stage using DOM elements
 */

import type { HUDData } from '../../../core/ui-model/HUDViewModel';

export class HUDOverlay {
  // HUD elements
  private healthBar: HTMLDivElement;
  private energyBar: HTMLDivElement;
  private healthText: HTMLDivElement;
  private energyText: HTMLDivElement;
  private stageText: HTMLDivElement;
  private countdownText: HTMLDivElement;

  constructor(container: HTMLElement) {
    // Create HUD container
    const hudContainer = document.createElement('div');
    hudContainer.style.position = 'absolute';
    hudContainer.style.top = '20px';
    hudContainer.style.left = '20px';
    hudContainer.style.pointerEvents = 'none';
    hudContainer.style.fontFamily = 'monospace';
    hudContainer.style.color = '#00ffff';
    hudContainer.style.fontSize = '14px';
    hudContainer.style.zIndex = '1000';

    // Health bar container
    const healthContainer = document.createElement('div');
    healthContainer.style.marginBottom = '8px';

    const healthLabel = document.createElement('div');
    healthLabel.textContent = 'HEALTH';
    healthLabel.style.marginBottom = '4px';
    healthContainer.appendChild(healthLabel);

    const healthBarBg = document.createElement('div');
    healthBarBg.style.width = '200px';
    healthBarBg.style.height = '20px';
    healthBarBg.style.backgroundColor = '#1a1a3e';
    healthBarBg.style.border = '1px solid #00ffff';
    healthBarBg.style.position = 'relative';

    this.healthBar = document.createElement('div');
    this.healthBar.style.width = '100%';
    this.healthBar.style.height = '100%';
    this.healthBar.style.backgroundColor = '#ff0088';
    this.healthBar.style.transition = 'width 0.2s';
    healthBarBg.appendChild(this.healthBar);

    this.healthText = document.createElement('div');
    this.healthText.style.position = 'absolute';
    this.healthText.style.top = '0';
    this.healthText.style.left = '0';
    this.healthText.style.width = '100%';
    this.healthText.style.textAlign = 'center';
    this.healthText.style.lineHeight = '20px';
    this.healthText.style.color = '#ffffff';
    this.healthText.style.fontWeight = 'bold';
    this.healthText.style.textShadow = '0 0 4px rgba(0,0,0,0.8)';
    healthBarBg.appendChild(this.healthText);

    healthContainer.appendChild(healthBarBg);

    // Energy bar container
    const energyContainer = document.createElement('div');
    energyContainer.style.marginBottom = '8px';

    const energyLabel = document.createElement('div');
    energyLabel.textContent = 'ENERGY';
    energyLabel.style.marginBottom = '4px';
    energyContainer.appendChild(energyLabel);

    const energyBarBg = document.createElement('div');
    energyBarBg.style.width = '200px';
    energyBarBg.style.height = '20px';
    energyBarBg.style.backgroundColor = '#1a1a3e';
    energyBarBg.style.border = '1px solid #00ffff';
    energyBarBg.style.position = 'relative';

    this.energyBar = document.createElement('div');
    this.energyBar.style.width = '100%';
    this.energyBar.style.height = '100%';
    this.energyBar.style.backgroundColor = '#00ff88';
    this.energyBar.style.transition = 'width 0.2s';
    energyBarBg.appendChild(this.energyBar);

    this.energyText = document.createElement('div');
    this.energyText.style.position = 'absolute';
    this.energyText.style.top = '0';
    this.energyText.style.left = '0';
    this.energyText.style.width = '100%';
    this.energyText.style.textAlign = 'center';
    this.energyText.style.lineHeight = '20px';
    this.energyText.style.color = '#ffffff';
    this.energyText.style.fontWeight = 'bold';
    this.energyText.style.textShadow = '0 0 4px rgba(0,0,0,0.8)';
    energyBarBg.appendChild(this.energyText);

    energyContainer.appendChild(energyBarBg);

    // Stage text
    this.stageText = document.createElement('div');
    this.stageText.style.marginTop = '12px';
    this.stageText.style.fontSize = '16px';
    this.stageText.style.fontWeight = 'bold';
    this.stageText.style.color = '#ffff00';

    // Countdown text (starvation timer)
    this.countdownText = document.createElement('div');
    this.countdownText.style.marginTop = '12px';
    this.countdownText.style.fontSize = '18px';
    this.countdownText.style.fontWeight = 'bold';
    this.countdownText.style.color = '#ff0000';
    this.countdownText.style.display = 'none';

    // Assemble HUD
    hudContainer.appendChild(healthContainer);
    hudContainer.appendChild(energyContainer);
    hudContainer.appendChild(this.stageText);
    hudContainer.appendChild(this.countdownText);

    container.appendChild(hudContainer);
  }

  /**
   * Update HUD from view model
   */
  update(data: HUDData): void {
    // Health bar
    this.healthBar.style.width = `${data.healthPercent}%`;
    this.healthText.textContent = data.healthText;

    // Energy bar
    this.energyBar.style.width = `${data.energyPercent}%`;
    this.energyText.textContent = data.energyText;

    // Stage
    this.stageText.textContent = `STAGE: ${data.stageText}`;

    // Countdown
    if (data.showCountdown && data.countdownText) {
      this.countdownText.textContent = `STARVING: ${data.countdownText}`;
      this.countdownText.style.display = 'block';
    } else {
      this.countdownText.style.display = 'none';
    }
  }

  /**
   * Dispose HUD
   */
  dispose(): void {
    // Remove from DOM (handled by parent container cleanup)
  }
}

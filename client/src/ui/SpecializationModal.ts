// ============================================
// Specialization Modal - Stage 3 Combat Pathway Selection
// ============================================

import type { CombatSpecialization } from '@godcell/shared';
import { eventBus } from '../core/events/EventBus';

export interface SpecializationModalOptions {
  playerId: string;
  deadline: number;
}

/**
 * Modal for selecting combat specialization when evolving to Stage 3.
 * Shows 3 pathway cards with countdown timer.
 * If player doesn't choose in time, server auto-assigns randomly.
 */
export class SpecializationModal {
  private container: HTMLDivElement;
  private countdownInterval: number | null = null;
  private deadline: number;

  constructor(options: SpecializationModalOptions) {
    this.deadline = options.deadline;
    this.container = this.createUI();
    document.body.appendChild(this.container);
    this.startCountdown();
  }

  private createUI(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'specialization-modal';
    container.innerHTML = `
      <div class="spec-content">
        <h2 class="spec-title">CHOOSE YOUR PATH</h2>
        <p class="spec-subtitle">Select your combat specialization</p>
        <div class="spec-countdown">
          <span class="countdown-label">Auto-assign in:</span>
          <span class="countdown-timer" id="spec-timer">5</span>
        </div>

        <div class="spec-cards">
          <button class="spec-card" data-spec="melee">
            <div class="spec-icon">⚔️</div>
            <div class="spec-card-text">
              <div class="spec-name">MELEE</div>
              <div class="spec-desc">Swipe and thrust attacks with knockback</div>
            </div>
          </button>

          <button class="spec-card" data-spec="ranged">
            <div class="spec-icon">🎯</div>
            <div class="spec-card-text">
              <div class="spec-name">RANGED</div>
              <div class="spec-desc">Rapid-fire projectiles at long range</div>
            </div>
          </button>

          <button class="spec-card" data-spec="traps">
            <div class="spec-icon">💥</div>
            <div class="spec-card-text">
              <div class="spec-name">TRAPS</div>
              <div class="spec-desc">Disguised mines that stun enemies</div>
            </div>
          </button>
        </div>

        <p class="spec-warning">⚠️ This choice is permanent for this life</p>
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.id = 'specialization-modal-styles';
    style.textContent = `
      #specialization-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 33%;
        min-width: 400px;
        max-width: 500px;
        background: rgba(10, 10, 20, 0.95);
        border: 2px solid rgba(255, 102, 0, 0.4);
        border-radius: 16px;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 20000;
        font-family: monospace;
        animation: fadeIn 0.3s ease-out;
        box-shadow: 0 0 60px rgba(255, 102, 0, 0.3);
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
        to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
      }

      .spec-content {
        text-align: center;
        padding: 30px 25px;
        width: 100%;
      }

      .spec-title {
        font-size: 36px;
        font-weight: bold;
        color: #ff6600;
        letter-spacing: 6px;
        margin: 0 0 10px 0;
        text-shadow:
          0 0 10px rgba(255, 102, 0, 0.8),
          0 0 20px rgba(255, 102, 0, 0.6);
      }

      .spec-subtitle {
        font-size: 14px;
        color: #888;
        margin: 0 0 20px 0;
        letter-spacing: 2px;
      }

      .spec-countdown {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 10px;
        margin-bottom: 30px;
      }

      .countdown-label {
        color: #666;
        font-size: 14px;
      }

      .countdown-timer {
        color: #ff6600;
        font-size: 28px;
        font-weight: bold;
        min-width: 40px;
        text-shadow: 0 0 10px rgba(255, 102, 0, 0.5);
      }

      .spec-cards {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }

      .spec-card {
        background: rgba(255, 102, 0, 0.1);
        border: 2px solid rgba(255, 102, 0, 0.3);
        border-radius: 8px;
        padding: 12px 15px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 15px;
        text-align: left;
      }

      .spec-card:hover {
        background: rgba(255, 102, 0, 0.2);
        border-color: rgba(255, 102, 0, 0.6);
        transform: translateX(4px);
        box-shadow: 0 4px 20px rgba(255, 102, 0, 0.3);
      }

      .spec-card:active {
        transform: translateX(2px);
      }

      .spec-icon {
        font-size: 28px;
        flex-shrink: 0;
      }

      .spec-card-text {
        flex: 1;
      }

      .spec-name {
        color: #ff6600;
        font-size: 14px;
        font-weight: bold;
        letter-spacing: 2px;
        margin-bottom: 2px;
      }

      .spec-desc {
        color: #888;
        font-size: 11px;
        line-height: 1.3;
      }

      .spec-warning {
        color: #666;
        font-size: 12px;
        margin: 0;
      }

      #specialization-modal.hiding {
        animation: fadeOut 0.3s ease-out forwards;
      }

      @keyframes fadeOut {
        to {
          opacity: 0;
          pointer-events: none;
        }
      }
    `;

    // Only add styles if not already present
    if (!document.getElementById('specialization-modal-styles')) {
      document.head.appendChild(style);
    }

    // Wire up card clicks
    setTimeout(() => {
      const cards = container.querySelectorAll('.spec-card');
      cards.forEach(card => {
        card.addEventListener('click', () => {
          const spec = card.getAttribute('data-spec') as CombatSpecialization;
          if (spec) {
            this.selectSpecialization(spec);
          }
        });
      });
    }, 0);

    return container;
  }

  private startCountdown(): void {
    this.updateTimer();
    this.countdownInterval = window.setInterval(() => {
      this.updateTimer();
    }, 100); // Update frequently for smooth countdown
  }

  private updateTimer(): void {
    const now = Date.now();
    const remaining = Math.max(0, this.deadline - now);
    const seconds = Math.ceil(remaining / 1000);

    const timerEl = document.getElementById('spec-timer');
    if (timerEl) {
      timerEl.textContent = seconds.toString();

      // Add urgency color when low
      if (seconds <= 2) {
        timerEl.style.color = '#ff3333';
      } else if (seconds <= 3) {
        timerEl.style.color = '#ffaa00';
      }
    }

    // If deadline passed, hide (server will auto-assign)
    if (remaining <= 0) {
      this.hide();
    }
  }

  private selectSpecialization(spec: CombatSpecialization): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    // Emit client event - SocketManager will send to server
    eventBus.emit({
      type: 'client:selectSpecialization',
      specialization: spec,
    });

    this.hide();
  }

  hide(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    this.container.classList.add('hiding');
    setTimeout(() => {
      this.container.remove();
    }, 300);
  }
}

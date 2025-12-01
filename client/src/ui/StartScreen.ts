// ============================================
// Start Screen - Title and Entry Point
// ============================================

export interface StartScreenOptions {
  onStart: (settings: PreGameSettings) => void;
  devMode?: boolean;
}

export interface PreGameSettings {
  playgroundMode: boolean;
  pauseOnStart: boolean;
}

export class StartScreen {
  private container: HTMLDivElement;
  private options: StartScreenOptions;
  private settings: PreGameSettings = {
    playgroundMode: false,
    pauseOnStart: false,
  };

  constructor(options: StartScreenOptions) {
    this.options = options;
    this.container = this.createUI();
    document.body.appendChild(this.container);
  }

  private createUI(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'start-screen';
    container.innerHTML = `
      <div class="start-content">
        <h1 class="start-title">GODCELL</h1>
        <p class="start-subtitle">"To become a god is to realize you're still just a cell in a vaster ocean."</p>

        ${this.options.devMode ? `
          <div class="dev-settings">
            <label class="dev-toggle">
              <input type="checkbox" id="setting-playground" />
              <span>Playground Mode</span>
              <span class="toggle-hint">Empty server for testing</span>
            </label>
            <label class="dev-toggle">
              <input type="checkbox" id="setting-pause" />
              <span>Pause on Start</span>
              <span class="toggle-hint">Server paused when you enter</span>
            </label>
          </div>
        ` : ''}

        <div class="start-buttons">
          <button class="start-button" id="start-play-btn">ENTER</button>
        </div>

        ${this.options.devMode ? `
          <div class="dev-links">
            <a href="/model-viewer.html" class="dev-link">Model Viewer</a>
            <span class="dev-separator">•</span>
            <span class="dev-hint">Press H in-game for dev panel</span>
          </div>
        ` : ''}
      </div>
    `;

    // Add styles
    const style = document.createElement('style');
    style.textContent = `
      #start-screen {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: radial-gradient(ellipse at center, #0a0a1a 0%, #000000 100%);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 20000;
        font-family: monospace;
      }

      .start-content {
        text-align: center;
        padding: 60px;
      }

      .start-title {
        font-size: 72px;
        font-weight: bold;
        color: #00ffff;
        letter-spacing: 16px;
        margin: 0 0 20px 0;
        text-shadow:
          0 0 10px rgba(0, 255, 255, 0.8),
          0 0 20px rgba(0, 255, 255, 0.6),
          0 0 40px rgba(0, 255, 255, 0.4),
          0 0 80px rgba(0, 255, 255, 0.2);
        animation: titlePulse 3s ease-in-out infinite;
      }

      @keyframes titlePulse {
        0%, 100% {
          text-shadow:
            0 0 10px rgba(0, 255, 255, 0.8),
            0 0 20px rgba(0, 255, 255, 0.6),
            0 0 40px rgba(0, 255, 255, 0.4),
            0 0 80px rgba(0, 255, 255, 0.2);
        }
        50% {
          text-shadow:
            0 0 20px rgba(0, 255, 255, 1),
            0 0 40px rgba(0, 255, 255, 0.8),
            0 0 60px rgba(0, 255, 255, 0.6),
            0 0 100px rgba(0, 255, 255, 0.4);
        }
      }

      .start-subtitle {
        font-size: 16px;
        color: #888;
        margin: 0 0 50px 0;
        letter-spacing: 2px;
      }

      .start-buttons {
        display: flex;
        flex-direction: column;
        gap: 15px;
        align-items: center;
      }

      .start-button {
        background: linear-gradient(135deg, #00ffff, #0088ff);
        border: none;
        padding: 18px 60px;
        font-size: 20px;
        font-family: monospace;
        font-weight: bold;
        color: #000;
        text-transform: uppercase;
        letter-spacing: 4px;
        cursor: pointer;
        border-radius: 4px;
        box-shadow: 0 0 30px rgba(0, 255, 255, 0.5);
        transition: all 0.2s;
        min-width: 250px;
      }

      .start-button:hover {
        background: linear-gradient(135deg, #00ffff, #00ccff);
        box-shadow: 0 0 50px rgba(0, 255, 255, 0.8);
        transform: scale(1.05);
      }

      .start-button:active {
        transform: scale(0.98);
      }

      .start-button.dev-button {
        background: linear-gradient(135deg, #ff00ff, #8800ff);
        box-shadow: 0 0 30px rgba(255, 0, 255, 0.5);
        font-size: 14px;
        padding: 12px 40px;
      }

      .start-button.dev-button:hover {
        background: linear-gradient(135deg, #ff00ff, #aa00ff);
        box-shadow: 0 0 50px rgba(255, 0, 255, 0.8);
      }

      .dev-settings {
        background: rgba(255, 0, 255, 0.1);
        border: 1px solid rgba(255, 0, 255, 0.3);
        border-radius: 8px;
        padding: 20px 30px;
        margin-bottom: 30px;
        display: flex;
        flex-direction: column;
        gap: 15px;
      }

      .dev-toggle {
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        color: #fff;
        font-size: 14px;
      }

      .dev-toggle input[type="checkbox"] {
        width: 18px;
        height: 18px;
        accent-color: #ff00ff;
        cursor: pointer;
      }

      .dev-toggle span:first-of-type {
        min-width: 140px;
      }

      .toggle-hint {
        color: #888;
        font-size: 12px;
      }

      .dev-links {
        margin-top: 30px;
        font-size: 12px;
        color: #888;
      }

      .dev-link {
        color: #ff00ff;
        text-decoration: none;
        transition: all 0.2s;
      }

      .dev-link:hover {
        color: #ff66ff;
        text-shadow: 0 0 10px rgba(255, 0, 255, 0.5);
      }

      .dev-separator {
        margin: 0 10px;
        color: #444;
      }

      .dev-hint {
        color: #666;
      }

      #start-screen.hiding {
        animation: fadeOut 0.5s ease-out forwards;
      }

      @keyframes fadeOut {
        to {
          opacity: 0;
          pointer-events: none;
        }
      }
    `;
    document.head.appendChild(style);

    // Wire up buttons after adding to DOM
    setTimeout(() => {
      const playBtn = document.getElementById('start-play-btn');
      playBtn?.addEventListener('click', () => this.handleStart());

      // Wire up settings checkboxes
      const playgroundCheckbox = document.getElementById('setting-playground') as HTMLInputElement;
      playgroundCheckbox?.addEventListener('change', (e) => {
        this.settings.playgroundMode = (e.target as HTMLInputElement).checked;
      });

      const pauseCheckbox = document.getElementById('setting-pause') as HTMLInputElement;
      pauseCheckbox?.addEventListener('change', (e) => {
        this.settings.pauseOnStart = (e.target as HTMLInputElement).checked;
      });
    }, 0);

    return container;
  }

  private handleStart(): void {
    this.hide();
    this.options.onStart(this.settings);
  }

  hide(): void {
    this.container.classList.add('hiding');
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }

  show(): void {
    this.container.classList.remove('hiding');
  }
}

// ============================================
// ECS X-Ray Panel - Entity Inspector for Demos
// Shows entity ID, tags, and components (live updating)
// ============================================

import {
  type World,
  type EntityId,
  Components,
  Tags,
  GAME_CONFIG,
  type PositionComponent,
  type EnergyComponent,
  type StageComponent,
  type SwarmComponent,
  type CooldownsComponent,
  type StunnedComponent,
  type SpawnImmunityComponent,
} from '#shared';
import { getStringIdByEntity } from '../ecs';

// ============================================
// Component Formatters - Custom display for components that need it
// ============================================

type ComponentFormatter = (component: unknown) => string[];

// Only define formatters for components where raw JSON isn't good enough
const COMPONENT_FORMATTERS: Partial<Record<string, ComponentFormatter>> = {
  [Components.Energy]: (c) => {
    const e = c as EnergyComponent;
    const pct = ((e.current / e.max) * 100).toFixed(0);
    return [`${e.current.toFixed(0)} / ${e.max.toFixed(0)} (${pct}%)`];
  },
  [Components.Stage]: (c) => {
    const s = c as StageComponent;
    const stageNames = ['', 'Single-Cell', 'Multi-Cell', 'Cyber-Organism', 'Humanoid', 'Godcell'];
    return [`${s.stage} (${stageNames[s.stage] || '?'})`, `radius: ${s.radius.toFixed(0)}`];
  },
  [Components.Swarm]: (c) => {
    const s = c as SwarmComponent;
    const lines = [`state: ${s.state}`, `size: ${s.size}`];
    if (s.targetPlayerId) lines.push(`target: ${s.targetPlayerId.slice(0, 8)}...`);
    if (s.disabledUntil && s.disabledUntil > Date.now()) {
      lines.push(`DISABLED (${((s.disabledUntil - Date.now()) / 1000).toFixed(1)}s)`);
    }
    return lines;
  },
  [Components.Cooldowns]: (c) => {
    const cd = c as CooldownsComponent;
    const now = Date.now();
    const lines: string[] = [];
    if (cd.lastEMPTime) {
      const remaining = Math.max(0, (cd.lastEMPTime + GAME_CONFIG.EMP_COOLDOWN - now) / 1000);
      lines.push(`EMP: ${remaining > 0 ? remaining.toFixed(1) + 's' : 'ready'}`);
    }
    if (cd.lastPseudopodTime) {
      const remaining = Math.max(0, (cd.lastPseudopodTime + GAME_CONFIG.PSEUDOPOD_COOLDOWN - now) / 1000);
      lines.push(`Beam: ${remaining > 0 ? remaining.toFixed(1) + 's' : 'ready'}`);
    }
    return lines.length ? lines : ['ready'];
  },
  [Components.Stunned]: (c) => {
    const s = c as StunnedComponent;
    if (s.until > Date.now()) {
      return [`STUNNED (${((s.until - Date.now()) / 1000).toFixed(1)}s)`];
    }
    return ['no'];
  },
  [Components.SpawnImmunity]: (c) => {
    const s = c as SpawnImmunityComponent;
    if (s.until > Date.now()) {
      return [`IMMUNE (${((s.until - Date.now()) / 1000).toFixed(1)}s)`];
    }
    return ['no'];
  },
};

// Default formatter: show object entries nicely
function defaultFormatter(component: unknown): string[] {
  if (component === null || component === undefined) return ['(empty)'];
  if (typeof component !== 'object') return [String(component)];

  const entries = Object.entries(component as Record<string, unknown>);
  if (entries.length === 0) return ['(empty)'];

  return entries.map(([k, v]) => {
    if (typeof v === 'number') return `${k}: ${Number.isInteger(v) ? v : v.toFixed(2)}`;
    if (typeof v === 'string') return `${k}: ${v.length > 20 ? v.slice(0, 17) + '...' : v}`;
    if (typeof v === 'boolean') return `${k}: ${v}`;
    if (v instanceof Set) return `${k}: Set(${v.size})`;
    if (Array.isArray(v)) return `${k}: [${v.length}]`;
    return `${k}: ${typeof v}`;
  });
}

// ============================================
// ECS X-Ray Panel Class
// ============================================

export interface ECSXRayPanelOptions {
  world: World;
}

const PANEL_SIZES = {
  compact: { width: 320, fontSize: 12, titleSize: 14, padding: 12, sectionGap: 12 },
  large: { width: 520, fontSize: 16, titleSize: 20, padding: 16, sectionGap: 16 },
  super: { width: 'fullscreen' as const, fontSize: 30, titleSize: 40, padding: 28, sectionGap: 22 },
};
type PanelSize = keyof typeof PANEL_SIZES;

const THEMES = {
  dark: {
    bg: 'rgba(0, 0, 0, 0.95)',
    border: '#0ff',
    title: '#0ff',
    text: '#aaa',
    accent: '#f0f',
    muted: '#666',
    highlight: '#0f0',
    shadow: 'rgba(0, 255, 255, 0.3)',
  },
  light: {
    bg: 'rgba(255, 255, 255, 0.98)',
    border: '#0066cc',
    title: '#0066cc',
    text: '#333',
    accent: '#cc00cc',
    muted: '#888',
    highlight: '#009900',
    shadow: 'rgba(0, 102, 204, 0.3)',
  },
};
type Theme = keyof typeof THEMES;

export class ECSXRayPanel {
  private world: World;
  private container: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private componentsEl: HTMLDivElement;
  private isVisible = false;
  private selectedEntityId: EntityId | null = null;
  private selectedStringId: string | null = null;
  private currentSize: PanelSize = 'compact';
  private currentTheme: Theme = 'dark';
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private entityList: Array<{ entityId: EntityId; stringId: string; tag: string }> = [];
  private entityListIndex = -1;

  constructor(options: ECSXRayPanelOptions) {
    this.world = options.world;

    // Build DOM
    this.container = document.createElement('div');
    this.container.id = 'ecs-xray-panel';
    this.container.style.cssText = `
      position: fixed; top: 80px; left: 10px; width: 320px;
      max-height: calc(100vh - 100px); overflow-y: auto;
      background: rgba(0, 0, 0, 0.95); color: #0ff;
      font-family: 'Courier New', monospace; font-size: 11px;
      padding: 12px; border: 1px solid #0ff; border-radius: 4px;
      z-index: 10000; box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
      display: flex; flex-direction: column;
    `;

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display: flex; justify-content: space-between; gap: 6px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #333;';

    const quickBtns = document.createElement('div');
    quickBtns.style.cssText = 'display: flex; gap: 4px; flex-wrap: wrap;';
    quickBtns.innerHTML = `
      <button class="xbtn" data-action="me">🎮 Me</button>
      <button class="xbtn" data-action="swarm">👾 Swarm</button>
      <button class="xbtn" data-action="bot">🤖 Bot</button>
      <button class="xbtn" data-action="serpent">🐍 Serpent</button>
    `;

    const toolBtns = document.createElement('div');
    toolBtns.style.cssText = 'display: flex; gap: 4px;';
    toolBtns.innerHTML = `
      <button class="xbtn" data-action="theme" title="Toggle theme">◐</button>
      <button class="xbtn" data-action="size" title="Cycle size">[ ]</button>
    `;

    toolbar.appendChild(quickBtns);
    toolbar.appendChild(toolBtns);

    // Style buttons
    const style = document.createElement('style');
    style.textContent = `
      #ecs-xray-panel .xbtn {
        background: #222; color: #0ff; border: 1px solid #444;
        padding: 3px 8px; font-family: monospace; font-size: 10px;
        cursor: pointer; border-radius: 3px;
      }
      #ecs-xray-panel .xbtn:hover { border-color: #0ff; }
      #ecs-xray-panel[data-theme="light"] .xbtn { background: #eee; color: #0066cc; border-color: #ccc; }
      #ecs-xray-panel[data-theme="light"] .xbtn:hover { border-color: #0066cc; }
    `;
    document.head.appendChild(style);

    this.headerEl = document.createElement('div');
    this.componentsEl = document.createElement('div');

    this.container.appendChild(toolbar);
    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.componentsEl);
    document.body.appendChild(this.container);

    // Event delegation for buttons
    toolbar.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'me') this.selectLocalPlayer();
      else if (action === 'swarm') this.selectNearestOfType(Tags.Swarm);
      else if (action === 'bot') this.selectNearestOfType(Tags.Bot);
      else if (action === 'serpent') this.selectNearestOfType(Tags.EntropySerpent);
      else if (action === 'theme') this.toggleTheme();
      else if (action === 'size') this.cycleSize();
    });

    this.setupKeyboardNavigation();
    this.hide();
  }

  private setupKeyboardNavigation(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.isVisible) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); this.cycleEntity(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); this.cycleEntity(-1); }
      else if (e.key === 'Escape') this.clearSelection();
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private buildEntityList(): void {
    this.entityList = [];
    const addTag = (tag: string) => {
      this.world.forEachWithTag(tag, (entity) => {
        const stringId = getStringIdByEntity(entity);
        if (stringId) this.entityList.push({ entityId: entity, stringId, tag });
      });
    };
    [Tags.Player, Tags.Swarm, Tags.EntropySerpent, Tags.JungleCreature, Tags.CyberBug,
     Tags.Nutrient, Tags.DataFruit, Tags.Tree, Tags.Obstacle].forEach(addTag);
  }

  private cycleEntity(dir: number): void {
    this.buildEntityList();
    if (this.entityList.length === 0) return;
    if (this.selectedStringId) {
      this.entityListIndex = this.entityList.findIndex(e => e.stringId === this.selectedStringId);
    }
    this.entityListIndex = (this.entityListIndex + dir + this.entityList.length) % this.entityList.length;
    this.selectEntity(this.entityList[this.entityListIndex].entityId);
  }

  private selectLocalPlayer(): void {
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const stringId = getStringIdByEntity(entity);
      if (stringId && !stringId.startsWith('bot-')) this.selectEntity(entity);
    });
  }

  private selectNearestOfType(tag: string): void {
    let playerPos: { x: number; y: number } | null = null;
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const stringId = getStringIdByEntity(entity);
      if (stringId && !stringId.startsWith('bot-')) {
        const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
        if (pos) playerPos = { x: pos.x, y: pos.y };
      }
    });
    if (!playerPos) return;

    let nearest: { entity: EntityId; dist: number } | null = null;
    this.world.forEachWithTag(tag, (entity) => {
      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      if (!pos) return;
      const dist = Math.hypot(pos.x - playerPos!.x, pos.y - playerPos!.y);
      if (!nearest || dist < nearest.dist) nearest = { entity, dist };
    });
    if (nearest) this.selectEntity(nearest.entity);
  }

  private toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyStyles();
  }

  private cycleSize(): void {
    const sizes: PanelSize[] = ['compact', 'large', 'super'];
    this.currentSize = sizes[(sizes.indexOf(this.currentSize) + 1) % sizes.length];
    this.applyStyles();
  }

  private applyStyles(): void {
    const size = PANEL_SIZES[this.currentSize];
    const theme = THEMES[this.currentTheme];

    this.container.setAttribute('data-theme', this.currentTheme);
    this.container.style.background = theme.bg;
    this.container.style.borderColor = theme.border;
    this.container.style.color = theme.text;
    this.container.style.boxShadow = `0 0 20px ${theme.shadow}`;

    let fontSize = size.fontSize;
    let padding = size.padding;

    if (size.width === 'fullscreen') {
      const gameContainer = document.getElementById('game-container');
      if (gameContainer) {
        const rect = gameContainer.getBoundingClientRect();
        this.container.style.width = `${rect.width}px`;
        this.container.style.height = `${rect.height}px`;
        this.container.style.maxHeight = `${rect.height}px`;
        this.container.style.top = `${rect.top}px`;
        this.container.style.left = `${rect.left}px`;
        const baseUnit = rect.height * 0.026;
        fontSize = Math.round(baseUnit);
        padding = Math.round(baseUnit * 1.2);
      }
      this.container.style.borderRadius = '0';
    } else {
      this.container.style.width = `${size.width}px`;
      this.container.style.height = 'auto';
      this.container.style.maxHeight = 'calc(100vh - 100px)';
      this.container.style.top = '80px';
      this.container.style.left = '10px';
      this.container.style.borderRadius = '4px';
    }

    this.container.style.fontSize = `${fontSize}px`;
    this.container.style.padding = `${padding}px`;
  }

  // Public API
  selectEntity(entityId: EntityId): void {
    this.selectedEntityId = entityId;
    this.selectedStringId = getStringIdByEntity(entityId) ?? null;
    this.show();
  }

  clearSelection(): void {
    this.selectedEntityId = null;
    this.selectedStringId = null;
  }

  toggle(): void {
    this.isVisible ? this.hide() : this.show();
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = 'flex';
    this.applyStyles();
  }

  hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
  }

  update(): void {
    if (!this.isVisible) return;

    const theme = THEMES[this.currentTheme];

    if (this.selectedEntityId === null) {
      this.headerEl.innerHTML = `<div style="color:${theme.title};font-weight:bold">ECS X-Ray</div>
        <div style="color:${theme.muted}">Click an entity to inspect</div>
        <div style="color:${theme.muted};margin-top:8px">← → to cycle, X to toggle</div>`;
      this.componentsEl.innerHTML = '';
      return;
    }

    const tags = this.world.getTags(this.selectedEntityId);
    if (!tags) {
      this.headerEl.innerHTML = `<div style="color:#f66">Entity no longer exists</div>`;
      this.componentsEl.innerHTML = '';
      this.selectedEntityId = null;
      return;
    }

    // Header
    const tagBadges = [...tags].map(t =>
      `<span style="background:${this.currentTheme === 'dark' ? '#333' : '#ddd'};color:${theme.highlight};padding:2px 6px;border-radius:3px;margin-right:4px">${t}</span>`
    ).join('');

    this.headerEl.innerHTML = `
      <div style="color:${theme.title};font-weight:bold;margin-bottom:8px">ECS X-Ray</div>
      <div style="margin-bottom:4px"><span style="color:${theme.muted}">Entity:</span> <span style="color:${theme.accent}">#${this.selectedEntityId}</span></div>
      ${this.selectedStringId ? `<div style="margin-bottom:4px"><span style="color:${theme.muted}">ID:</span> <span style="color:${theme.title}">${this.selectedStringId}</span></div>` : ''}
      <div style="margin-bottom:8px"><span style="color:${theme.muted}">Tags:</span> ${tagBadges || `<span style="color:${theme.muted}">(none)</span>`}</div>
    `;

    // Components
    let html = `<div style="color:${theme.title};font-weight:bold;margin-bottom:8px;border-bottom:1px solid ${this.currentTheme === 'dark' ? '#333' : '#ccc'};padding-bottom:4px">Components</div>`;

    const componentTypes = Object.values(Components);
    let hasAny = false;

    for (const compType of componentTypes) {
      const component = this.world.getComponent(this.selectedEntityId, compType);
      if (component !== undefined) {
        hasAny = true;
        const formatter = COMPONENT_FORMATTERS[compType];
        const lines = formatter ? formatter(component) : defaultFormatter(component);
        html += `<div style="margin-bottom:8px;padding-left:8px;border-left:2px solid ${this.currentTheme === 'dark' ? '#333' : '#ccc'}">`;
        html += `<div style="color:${theme.accent};font-weight:bold">${compType}</div>`;
        for (const line of lines) {
          if (line) html += `<div style="padding-left:8px">${this.escapeHtml(line)}</div>`;
        }
        html += '</div>';
      }
    }

    if (!hasAny) html += `<div style="color:${theme.muted}">(no components)</div>`;
    this.componentsEl.innerHTML = html;
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container.remove();
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

// ============================================
// ECS X-Ray Panel - Entity Inspector for Demos
// Shows entity ID, tag, components, and systems
// ============================================

import {
  type World,
  type EntityId,
  Components,
  Tags,
  type PositionComponent,
  type VelocityComponent,
  type EnergyComponent,
  type PlayerComponent,
  type StageComponent,
  type InputComponent,
  type SwarmComponent,
  type NutrientComponent,
  type ObstacleComponent,
  type PseudopodComponent,
  type CooldownsComponent,
  type StunnedComponent,
  type SpawnImmunityComponent,
  type DamageTrackingComponent,
  type CanDetectComponent,
  type DataFruitComponent,
  type CyberBugComponent,
  type JungleCreatureComponent,
  type EntropySerpentComponent,
  type ProjectileComponent,
  type TrapComponent,
  type TreeComponent,
  type CombatSpecializationComponent,
} from '#shared';
import { getStringIdByEntity } from '../ecs';

// ============================================
// System Mapping - Which server systems process each tag
// ============================================

const TAG_TO_SYSTEMS: Record<string, string[]> = {
  [Tags.Player]: [
    'BotAISystem (if bot)',
    'GravitySystem',
    'PseudopodSystem',
    'PredationSystem',
    'SwarmCollisionSystem',
    'TreeCollisionSystem',
    'MovementSystem',
    'MetabolismSystem',
    'NutrientCollisionSystem',
    'MacroResourceCollisionSystem',
    'DeathSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Bot]: [
    'BotAISystem',
    'GravitySystem',
    'PseudopodSystem',
    'PredationSystem',
    'SwarmCollisionSystem',
    'TreeCollisionSystem',
    'MovementSystem',
    'MetabolismSystem',
    'NutrientCollisionSystem',
    'MacroResourceCollisionSystem',
    'DeathSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Swarm]: [
    'SwarmAISystem',
    'SwarmCollisionSystem',
    'DeathSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Nutrient]: [
    'NutrientCollisionSystem',
    'NutrientAttractionSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Obstacle]: [
    'GravitySystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Pseudopod]: [
    'PseudopodSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Tree]: [
    'TreeCollisionSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.DataFruit]: [
    'DataFruitSystem',
    'MacroResourceCollisionSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.CyberBug]: [
    'CyberBugAISystem',
    'MacroResourceCollisionSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.JungleCreature]: [
    'JungleCreatureAISystem',
    'MacroResourceCollisionSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.EntropySerpent]: [
    'EntropySerpentAISystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Projectile]: [
    'ProjectileSystem',
    'NetworkBroadcastSystem',
  ],
  [Tags.Trap]: [
    'TrapSystem',
    'NetworkBroadcastSystem',
  ],
};

// ============================================
// Component Formatters - How to display each component
// ============================================

type ComponentFormatter = (component: unknown) => string[];

const COMPONENT_FORMATTERS: Record<string, ComponentFormatter> = {
  [Components.Position]: (c) => {
    const pos = c as PositionComponent;
    const lines = [`x: ${pos.x.toFixed(1)}`, `y: ${pos.y.toFixed(1)}`];
    if (pos.z !== undefined && pos.z !== 0) lines.push(`z: ${pos.z.toFixed(1)}`);
    return lines;
  },
  [Components.Velocity]: (c) => {
    const vel = c as VelocityComponent;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
    return [`vx: ${vel.x.toFixed(1)}`, `vy: ${vel.y.toFixed(1)}`, `speed: ${speed.toFixed(1)}`];
  },
  [Components.Energy]: (c) => {
    const e = c as EnergyComponent;
    const pct = ((e.current / e.max) * 100).toFixed(0);
    return [`${e.current.toFixed(0)} / ${e.max.toFixed(0)} (${pct}%)`];
  },
  [Components.Player]: (c) => {
    const p = c as PlayerComponent;
    return [`name: ${p.name}`, `socketId: ${p.socketId.slice(0, 8)}...`, `color: ${p.color}`];
  },
  [Components.Stage]: (c) => {
    const s = c as StageComponent;
    const stageNames = ['', 'Single-Cell', 'Multi-Cell', 'Cyber-Organism', 'Humanoid', 'Godcell'];
    return [
      `stage: ${s.stage} (${stageNames[s.stage] || 'unknown'})`,
      `radius: ${s.radius.toFixed(0)}`,
      s.isEvolving ? 'EVOLVING' : '',
    ].filter(Boolean);
  },
  [Components.Input]: (c) => {
    const i = c as InputComponent;
    return [`dir: (${i.direction.x}, ${i.direction.y})`];
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
  [Components.Nutrient]: (c) => {
    const n = c as NutrientComponent;
    return [
      `value: ${n.value}`,
      `capacity+: ${n.capacityIncrease}`,
      `multiplier: ${n.valueMultiplier}x`,
      n.isHighValue ? 'HIGH VALUE' : '',
    ].filter(Boolean);
  },
  [Components.Obstacle]: (c) => {
    const o = c as ObstacleComponent;
    return [`radius: ${o.radius}`, `strength: ${o.strength.toFixed(2)}`];
  },
  [Components.Pseudopod]: (c) => {
    const p = c as PseudopodComponent;
    return [
      `owner: ${p.ownerSocketId.slice(0, 8)}...`,
      `traveled: ${p.distanceTraveled.toFixed(0)} / ${p.maxDistance}`,
      `hits: ${p.hitEntities.size}`,
    ];
  },
  [Components.Cooldowns]: (c) => {
    const cd = c as CooldownsComponent;
    const now = Date.now();
    const lines: string[] = [];
    if (cd.lastEMPTime) {
      const remaining = Math.max(0, (cd.lastEMPTime + 10000 - now) / 1000);
      lines.push(`EMP: ${remaining > 0 ? remaining.toFixed(1) + 's' : 'ready'}`);
    }
    if (cd.lastPseudopodTime) {
      const remaining = Math.max(0, (cd.lastPseudopodTime + 500 - now) / 1000);
      lines.push(`Beam: ${remaining > 0 ? remaining.toFixed(1) + 's' : 'ready'}`);
    }
    return lines.length ? lines : ['(no cooldowns)'];
  },
  [Components.Stunned]: (c) => {
    const s = c as StunnedComponent;
    if (s.until > Date.now()) {
      return [`STUNNED (${((s.until - Date.now()) / 1000).toFixed(1)}s)`];
    }
    return ['(not stunned)'];
  },
  [Components.SpawnImmunity]: (c) => {
    const s = c as SpawnImmunityComponent;
    if (s.until > Date.now()) {
      return [`IMMUNE (${((s.until - Date.now()) / 1000).toFixed(1)}s)`];
    }
    return ['(no immunity)'];
  },
  [Components.DamageTracking]: (c) => {
    const d = c as DamageTrackingComponent;
    const lines: string[] = [];
    if (d.lastDamageSource) lines.push(`lastSource: ${d.lastDamageSource}`);
    if (d.activeDamage.length > 0) {
      lines.push(`activeSources: ${d.activeDamage.length}`);
    }
    return lines.length ? lines : ['(no damage)'];
  },
  [Components.CanDetect]: (c) => {
    const d = c as CanDetectComponent;
    return [`radius: ${d.radius}`];
  },
  [Components.CombatSpecialization]: (c) => {
    const s = c as CombatSpecializationComponent;
    if (s.selectionPending) return ['PENDING SELECTION'];
    return [s.specialization || '(none)'];
  },
  [Components.DataFruit]: (c) => {
    const f = c as DataFruitComponent;
    return [
      `value: ${f.value}`,
      `ripeness: ${(f.ripeness * 100).toFixed(0)}%`,
      f.fallenAt ? 'FALLEN' : 'on tree',
    ];
  },
  [Components.CyberBug]: (c) => {
    const b = c as CyberBugComponent;
    return [`state: ${b.state}`, `value: ${b.value}`];
  },
  [Components.JungleCreature]: (c) => {
    const j = c as JungleCreatureComponent;
    return [`variant: ${j.variant}`, `state: ${j.state}`, `value: ${j.value}`];
  },
  [Components.EntropySerpent]: (c) => {
    const s = c as EntropySerpentComponent;
    return [`state: ${s.state}`, `size: ${s.size}`, `heading: ${((s.heading * 180) / Math.PI).toFixed(0)}°`];
  },
  [Components.Projectile]: (c) => {
    const p = c as ProjectileComponent;
    return [`damage: ${p.damage}`, `state: ${p.state}`, `traveled: ${p.distanceTraveled.toFixed(0)}`];
  },
  [Components.Trap]: (c) => {
    const t = c as TrapComponent;
    const age = Date.now() - t.placedAt;
    const remaining = Math.max(0, (t.lifetime - age) / 1000);
    return [`damage: ${t.damage}`, `stun: ${t.stunDuration}ms`, `expires: ${remaining.toFixed(1)}s`];
  },
  [Components.Tree]: (c) => {
    const t = c as TreeComponent;
    return [`radius: ${t.radius}`, `height: ${t.height}`];
  },
  // Marker components (no data)
  [Components.CanFireEMP]: () => ['(enabled)'],
  [Components.CanFirePseudopod]: () => ['(enabled)'],
  [Components.CanSprint]: () => ['(enabled)'],
  [Components.CanEngulf]: () => ['(enabled)'],
  [Components.Sprint]: (c) => [(c as { isSprinting: boolean }).isSprinting ? 'SPRINTING' : 'not sprinting'],
};

// ============================================
// ECS X-Ray Panel Class
// ============================================

export interface ECSXRayPanelOptions {
  world: World;
  onHighlight?: (stringId: string | null) => void; // Callback for visual highlight sync
}

// Panel size presets (optimized for projector demos)
const PANEL_SIZES = {
  compact: { width: 320, fontSize: 12, titleSize: 14, padding: 12 },
  large: { width: 520, fontSize: 16, titleSize: 20, padding: 16 },
  xlarge: { width: 700, fontSize: 22, titleSize: 28, padding: 20 },
  super: { width: 1200, fontSize: 32, titleSize: 42, padding: 30 },
};
type PanelSize = keyof typeof PANEL_SIZES;

// Theme presets
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
  private toolbarEl: HTMLDivElement;
  private quickSelectEl: HTMLDivElement;
  private headerEl: HTMLDivElement;
  private componentsEl: HTMLDivElement;
  private systemsEl: HTMLDivElement;
  private isVisible = false;
  private selectedEntityId: EntityId | null = null;
  private selectedStringId: string | null = null;
  private currentSize: PanelSize = 'compact';
  private currentTheme: Theme = 'dark';
  private onHighlight?: (stringId: string | null) => void;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  // Entity list for arrow key cycling
  private entityList: Array<{ entityId: EntityId; stringId: string; tag: string }> = [];
  private entityListIndex = -1;

  constructor(options: ECSXRayPanelOptions) {
    this.world = options.world;
    this.onHighlight = options.onHighlight;
    this.container = this.createContainer();
    this.toolbarEl = this.createToolbar();
    this.quickSelectEl = this.createQuickSelect();
    this.headerEl = this.createSection('header');
    this.componentsEl = this.createSection('components');
    this.systemsEl = this.createSection('systems');

    this.container.appendChild(this.toolbarEl);
    this.container.appendChild(this.quickSelectEl);
    this.container.appendChild(this.headerEl);
    this.container.appendChild(this.componentsEl);
    this.container.appendChild(this.systemsEl);

    document.body.appendChild(this.container);
    this.setupKeyboardNavigation();
    this.hide(); // Start hidden
  }

  private createContainer(): HTMLDivElement {
    const container = document.createElement('div');
    container.id = 'ecs-xray-panel';
    container.style.cssText = `
      position: fixed;
      top: 80px;
      left: 10px;
      width: 320px;
      max-height: calc(100vh - 100px);
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.9);
      color: #0ff;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      padding: 12px;
      border: 1px solid #0ff;
      border-radius: 4px;
      z-index: 10000;
      pointer-events: auto;
      box-shadow: 0 0 20px rgba(0, 255, 255, 0.3);
    `;
    return container;
  }

  private createSection(id: string): HTMLDivElement {
    const section = document.createElement('div');
    section.id = `ecs-xray-${id}`;
    section.style.cssText = 'margin-bottom: 12px;';
    return section;
  }

  private createToolbar(): HTMLDivElement {
    const toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    `;

    const createButton = (text: string, title: string, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.title = title;
      btn.className = 'xray-toolbar-btn';
      btn.style.cssText = `
        background: #222;
        color: #0ff;
        border: 1px solid #0ff;
        padding: 4px 10px;
        font-family: monospace;
        font-size: 12px;
        cursor: pointer;
        border-radius: 3px;
      `;
      btn.addEventListener('click', onClick);
      btn.addEventListener('mouseenter', () => { btn.style.background = '#0ff'; btn.style.color = '#000'; });
      btn.addEventListener('mouseleave', () => this.styleToolbarButton(btn));
      return btn;
    };

    // Theme toggle button
    const themeBtn = createButton('◐', 'Toggle light/dark mode', () => this.toggleTheme());
    toolbar.appendChild(themeBtn);

    // Size cycle button
    const sizeBtn = createButton('[ ]', 'Cycle panel size (compact → large → XL → SUPER)', () => this.cycleSize());
    toolbar.appendChild(sizeBtn);

    return toolbar;
  }

  private createQuickSelect(): HTMLDivElement {
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    `;

    const createBtn = (text: string, title: string, onClick: () => void) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      btn.title = title;
      btn.className = 'xray-quick-btn';
      btn.style.cssText = `
        background: #111;
        color: #0ff;
        border: 1px solid #333;
        padding: 3px 8px;
        font-family: monospace;
        font-size: 10px;
        cursor: pointer;
        border-radius: 3px;
      `;
      btn.addEventListener('click', onClick);
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#0ff'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#333'; });
      return btn;
    };

    // Quick select buttons
    container.appendChild(createBtn('🎮 Me', 'Select local player', () => this.selectLocalPlayer()));
    container.appendChild(createBtn('👾 Swarm', 'Select nearest swarm', () => this.selectNearestOfType(Tags.Swarm)));
    container.appendChild(createBtn('🤖 Bot', 'Select nearest bot', () => this.selectNearestOfType(Tags.Bot)));
    container.appendChild(createBtn('🌳 Tree', 'Select nearest tree', () => this.selectNearestOfType(Tags.Tree)));
    container.appendChild(createBtn('🐍 Serpent', 'Select nearest serpent', () => this.selectNearestOfType(Tags.EntropySerpent)));

    // Navigation hint
    const hint = document.createElement('span');
    hint.setAttribute('data-muted', 'true');
    hint.style.cssText = 'font-size: 9px; margin-left: auto; align-self: center;';
    hint.textContent = '← → cycle';
    container.appendChild(hint);

    return container;
  }

  private setupKeyboardNavigation(): void {
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.isVisible) return;

      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.cycleEntity(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.cycleEntity(-1);
      } else if (e.key === 'Escape') {
        this.clearSelection();
        this.onHighlight?.(null);
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  private buildEntityList(): void {
    this.entityList = [];

    // Collect all entities with positions
    const addEntities = (tag: string) => {
      this.world.forEachWithTag(tag, (entity) => {
        const stringId = getStringIdByEntity(entity);
        if (stringId) {
          this.entityList.push({ entityId: entity, stringId, tag });
        }
      });
    };

    // Add entities in a logical order for cycling
    addEntities(Tags.Player);
    addEntities(Tags.Swarm);
    addEntities(Tags.EntropySerpent);
    addEntities(Tags.JungleCreature);
    addEntities(Tags.CyberBug);
    addEntities(Tags.Nutrient);
    addEntities(Tags.DataFruit);
    addEntities(Tags.Tree);
    addEntities(Tags.Obstacle);
    addEntities(Tags.Projectile);
    addEntities(Tags.Trap);
  }

  private cycleEntity(direction: number): void {
    this.buildEntityList();
    if (this.entityList.length === 0) return;

    // Find current index
    if (this.selectedStringId) {
      this.entityListIndex = this.entityList.findIndex(e => e.stringId === this.selectedStringId);
    }

    // Move to next/prev
    this.entityListIndex += direction;
    if (this.entityListIndex < 0) this.entityListIndex = this.entityList.length - 1;
    if (this.entityListIndex >= this.entityList.length) this.entityListIndex = 0;

    const entity = this.entityList[this.entityListIndex];
    this.selectEntity(entity.entityId);
    this.onHighlight?.(entity.stringId);
  }

  private selectLocalPlayer(): void {
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const stringId = getStringIdByEntity(entity);
      // Local player doesn't have 'bot-' prefix
      if (stringId && !stringId.startsWith('bot-')) {
        this.selectEntity(entity);
        this.onHighlight?.(stringId);
      }
    });
  }

  private selectNearestOfType(tag: string): void {
    // Get local player position for distance calculation
    let playerPos: { x: number; y: number } | null = null;
    this.world.forEachWithTag(Tags.Player, (entity) => {
      const stringId = getStringIdByEntity(entity);
      if (stringId && !stringId.startsWith('bot-')) {
        const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
        if (pos) playerPos = { x: pos.x, y: pos.y };
      }
    });

    if (!playerPos) return;

    // Find nearest entity of type
    let nearest: { entity: EntityId; stringId: string; dist: number } | null = null;
    this.world.forEachWithTag(tag, (entity) => {
      const pos = this.world.getComponent<PositionComponent>(entity, Components.Position);
      const stringId = getStringIdByEntity(entity);
      if (!pos || !stringId) return;

      const dx = pos.x - playerPos!.x;
      const dy = pos.y - playerPos!.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!nearest || dist < nearest.dist) {
        nearest = { entity, stringId, dist };
      }
    });

    if (nearest) {
      this.selectEntity(nearest.entity);
      this.onHighlight?.(nearest.stringId);
    }
  }

  private styleToolbarButton(btn: HTMLElement): void {
    const theme = THEMES[this.currentTheme];
    btn.style.background = this.currentTheme === 'dark' ? '#222' : '#eee';
    btn.style.color = theme.title;
    btn.style.borderColor = theme.border;
  }

  private toggleTheme(): void {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme();
  }

  private applyTheme(): void {
    const theme = THEMES[this.currentTheme];
    this.container.style.background = theme.bg;
    this.container.style.borderColor = theme.border;
    this.container.style.color = theme.text;
    this.container.style.boxShadow = `0 0 20px ${theme.shadow}`;

    // Update toolbar buttons
    const buttons = this.toolbarEl.querySelectorAll('.xray-toolbar-btn');
    buttons.forEach((btn) => this.styleToolbarButton(btn as HTMLElement));

    // Update toolbar border
    this.toolbarEl.style.borderBottomColor = this.currentTheme === 'dark' ? '#333' : '#ccc';
  }

  private cycleSize(): void {
    const sizes: PanelSize[] = ['compact', 'large', 'xlarge', 'super'];
    const currentIndex = sizes.indexOf(this.currentSize);
    this.currentSize = sizes[(currentIndex + 1) % sizes.length];
    this.applySize();
  }

  private applySize(): void {
    const size = PANEL_SIZES[this.currentSize];
    const theme = THEMES[this.currentTheme];

    this.container.style.width = `${size.width}px`;
    this.container.style.fontSize = `${size.fontSize}px`;
    this.container.style.padding = `${size.padding}px`;

    // Update title sizes and colors
    const titles = this.container.querySelectorAll('[data-title]');
    titles.forEach((el) => {
      (el as HTMLElement).style.fontSize = `${size.titleSize}px`;
      (el as HTMLElement).style.color = theme.title;
    });

    // Update accent colors (component names)
    const accents = this.container.querySelectorAll('[data-accent]');
    accents.forEach((el) => {
      (el as HTMLElement).style.color = theme.accent;
    });

    // Update muted colors
    const muted = this.container.querySelectorAll('[data-muted]');
    muted.forEach((el) => {
      (el as HTMLElement).style.color = theme.muted;
    });

    // Update highlight colors (system names)
    const highlights = this.container.querySelectorAll('[data-highlight]');
    highlights.forEach((el) => {
      (el as HTMLElement).style.color = theme.highlight;
    });

    // Update tag badges
    const tagBadges = this.container.querySelectorAll('[data-tag-badge]');
    tagBadges.forEach((el) => {
      const badgeEl = el as HTMLElement;
      badgeEl.style.background = this.currentTheme === 'dark' ? '#333' : '#e0e0e0';
      badgeEl.style.color = theme.highlight;
    });

    // Update section borders
    const sectionTitles = this.container.querySelectorAll('[data-section-title]');
    sectionTitles.forEach((el) => {
      (el as HTMLElement).style.borderBottomColor = this.currentTheme === 'dark' ? '#333' : '#ccc';
    });

    // Update component wrapper borders
    const componentWrappers = this.container.querySelectorAll('[data-component-wrapper]');
    componentWrappers.forEach((el) => {
      (el as HTMLElement).style.borderLeftColor = this.currentTheme === 'dark' ? '#333' : '#ccc';
    });

    // Scale toolbar buttons with panel size
    const btnFontSize = Math.max(12, size.fontSize - 4);
    const btnPadding = Math.max(4, size.padding / 3);
    const buttons = this.toolbarEl.querySelectorAll('.xray-toolbar-btn');
    buttons.forEach((btn) => {
      const btnEl = btn as HTMLElement;
      btnEl.style.fontSize = `${btnFontSize}px`;
      btnEl.style.padding = `${btnPadding}px ${btnPadding * 2}px`;
    });

    // Scale quick select buttons with panel size
    const quickBtnFontSize = Math.max(10, size.fontSize - 6);
    const quickBtns = this.quickSelectEl.querySelectorAll('.xray-quick-btn');
    quickBtns.forEach((btn) => {
      const btnEl = btn as HTMLElement;
      btnEl.style.fontSize = `${quickBtnFontSize}px`;
      btnEl.style.padding = `${Math.max(3, btnPadding - 2)}px ${Math.max(6, btnPadding)}px`;
    });

    // Scale quick select border and gap
    this.quickSelectEl.style.gap = `${Math.max(4, size.padding / 3)}px`;
    this.quickSelectEl.style.borderBottomColor = this.currentTheme === 'dark' ? '#333' : '#ccc';

    // Apply theme to container
    this.applyTheme();
  }

  // ----------------------------------------
  // Public API
  // ----------------------------------------

  selectEntity(entityId: EntityId): void {
    this.selectedEntityId = entityId;
    this.selectedStringId = getStringIdByEntity(entityId) ?? null;
    this.show();
  }

  selectByStringId(stringId: string): void {
    // Find entity by iterating (we could add reverse lookup if needed)
    let found: EntityId | null = null;
    const allTags = Object.values(Tags);
    for (const tag of allTags) {
      this.world.forEachWithTag(tag, (entity) => {
        if (getStringIdByEntity(entity) === stringId) {
          found = entity;
        }
      });
      if (found !== null) break;
    }
    if (found !== null) {
      this.selectEntity(found);
    }
  }

  clearSelection(): void {
    this.selectedEntityId = null;
    this.selectedStringId = null;
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.isVisible = true;
    this.container.style.display = 'block';
  }

  hide(): void {
    this.isVisible = false;
    this.container.style.display = 'none';
  }

  /**
   * Called each frame to update component values
   */
  update(): void {
    if (!this.isVisible) return;

    if (this.selectedEntityId === null) {
      this.renderNoSelection();
      this.applySize(); // Scale titles after render
      return;
    }

    // Check if entity still exists
    const tags = this.world.getTags(this.selectedEntityId);
    if (!tags) {
      this.renderEntityGone();
      this.applySize(); // Scale titles after render
      return;
    }

    this.renderHeader(this.selectedEntityId, this.selectedStringId, tags);
    this.renderComponents(this.selectedEntityId);
    this.renderSystems(tags);
    this.applySize(); // Scale titles after render
  }

  dispose(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.container.remove();
  }

  // ----------------------------------------
  // Rendering
  // ----------------------------------------

  private renderNoSelection(): void {
    this.headerEl.textContent = '';
    this.componentsEl.textContent = '';
    this.systemsEl.textContent = '';

    const title = document.createElement('div');
    title.setAttribute('data-title', 'true');
    title.style.cssText = 'font-weight: bold; margin-bottom: 8px;';
    title.textContent = 'ECS X-Ray';
    this.headerEl.appendChild(title);

    const hint = document.createElement('div');
    hint.setAttribute('data-muted', 'true');
    hint.style.cssText = 'margin-bottom: 4px;';
    hint.textContent = 'Click an entity to inspect it';
    this.headerEl.appendChild(hint);

    const hint2 = document.createElement('div');
    hint2.setAttribute('data-muted', 'true');
    hint2.style.cssText = 'margin-top: 8px;';
    hint2.textContent = 'Press X to toggle this panel';
    this.headerEl.appendChild(hint2);
  }

  private renderEntityGone(): void {
    this.headerEl.textContent = '';
    this.componentsEl.textContent = '';
    this.systemsEl.textContent = '';

    const msg = document.createElement('div');
    msg.style.cssText = 'color: #f66;';
    msg.textContent = 'Entity no longer exists';
    this.headerEl.appendChild(msg);

    this.selectedEntityId = null;
    this.selectedStringId = null;
  }

  private renderHeader(entityId: EntityId, stringId: string | null, tags: Set<string>): void {
    this.headerEl.textContent = '';

    // Title
    const title = document.createElement('div');
    title.setAttribute('data-title', 'true');
    title.style.cssText = 'font-weight: bold; margin-bottom: 8px;';
    title.textContent = 'ECS X-Ray';
    this.headerEl.appendChild(title);

    // Entity ID
    const idLine = document.createElement('div');
    idLine.style.cssText = 'margin-bottom: 4px;';
    const idLabel = document.createElement('span');
    idLabel.setAttribute('data-muted', 'true');
    idLabel.textContent = 'Entity: ';
    const idValue = document.createElement('span');
    idValue.setAttribute('data-accent', 'true');
    idValue.textContent = `#${entityId}`;
    idLine.appendChild(idLabel);
    idLine.appendChild(idValue);
    this.headerEl.appendChild(idLine);

    // String ID
    if (stringId) {
      const stringIdLine = document.createElement('div');
      stringIdLine.style.cssText = 'margin-bottom: 4px;';
      const strLabel = document.createElement('span');
      strLabel.setAttribute('data-muted', 'true');
      strLabel.textContent = 'ID: ';
      const strValue = document.createElement('span');
      strValue.setAttribute('data-title', 'true'); // Use title color (cyan/blue)
      strValue.textContent = this.escapeHtml(stringId);
      stringIdLine.appendChild(strLabel);
      stringIdLine.appendChild(strValue);
      this.headerEl.appendChild(stringIdLine);
    }

    // Tags
    const tagsLine = document.createElement('div');
    tagsLine.style.cssText = 'margin-bottom: 4px;';
    const tagsLabel = document.createElement('span');
    tagsLabel.setAttribute('data-muted', 'true');
    tagsLabel.textContent = 'Tags: ';
    tagsLine.appendChild(tagsLabel);

    if (tags.size > 0) {
      for (const t of tags) {
        const badge = document.createElement('span');
        badge.setAttribute('data-tag-badge', 'true');
        badge.style.cssText = 'padding: 2px 6px; border-radius: 3px; margin-right: 4px;';
        badge.textContent = this.escapeHtml(t);
        tagsLine.appendChild(badge);
      }
    } else {
      const noneSpan = document.createElement('span');
      noneSpan.setAttribute('data-muted', 'true');
      noneSpan.textContent = '(none)';
      tagsLine.appendChild(noneSpan);
    }
    this.headerEl.appendChild(tagsLine);
  }

  private renderComponents(entityId: EntityId): void {
    this.componentsEl.textContent = '';

    const sectionTitle = document.createElement('div');
    sectionTitle.setAttribute('data-title', 'true');
    sectionTitle.setAttribute('data-section-title', 'true');
    sectionTitle.style.cssText = 'font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid; padding-bottom: 4px;';
    sectionTitle.textContent = 'Components';
    this.componentsEl.appendChild(sectionTitle);

    // Check all component types
    const componentTypes = Object.values(Components);
    let hasAny = false;

    for (const compType of componentTypes) {
      const component = this.world.getComponent(entityId, compType);
      if (component !== undefined) {
        hasAny = true;
        this.renderComponent(compType, component);
      }
    }

    if (!hasAny) {
      const none = document.createElement('div');
      none.setAttribute('data-muted', 'true');
      none.textContent = '(no components)';
      this.componentsEl.appendChild(none);
    }
  }

  private renderComponent(type: string, component: unknown): void {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-component-wrapper', 'true');
    wrapper.style.cssText = 'margin-bottom: 8px; padding-left: 8px; border-left: 2px solid;';

    // Component name
    const name = document.createElement('div');
    name.setAttribute('data-accent', 'true');
    name.style.cssText = 'font-weight: bold;';
    name.textContent = type;
    wrapper.appendChild(name);

    // Component values
    const formatter = COMPONENT_FORMATTERS[type];
    const lines = formatter ? formatter(component) : [JSON.stringify(component)];

    for (const line of lines) {
      if (!line) continue;
      const lineEl = document.createElement('div');
      lineEl.style.cssText = 'padding-left: 8px;';
      lineEl.textContent = line;
      wrapper.appendChild(lineEl);
    }

    this.componentsEl.appendChild(wrapper);
  }

  private renderSystems(tags: Set<string>): void {
    this.systemsEl.textContent = '';

    const sectionTitle = document.createElement('div');
    sectionTitle.setAttribute('data-title', 'true');
    sectionTitle.setAttribute('data-section-title', 'true');
    sectionTitle.style.cssText = 'font-weight: bold; margin-bottom: 8px; border-bottom: 1px solid; padding-bottom: 4px;';
    sectionTitle.textContent = 'Server Systems (process order)';
    this.systemsEl.appendChild(sectionTitle);

    // Collect systems from all tags
    const systemSet = new Set<string>();
    for (const tag of tags) {
      const systems = TAG_TO_SYSTEMS[tag];
      if (systems) {
        for (const sys of systems) {
          systemSet.add(sys);
        }
      }
    }

    if (systemSet.size === 0) {
      const none = document.createElement('div');
      none.setAttribute('data-muted', 'true');
      none.textContent = '(unknown)';
      this.systemsEl.appendChild(none);
      return;
    }

    // Display systems
    const systemList = document.createElement('div');
    systemList.style.cssText = 'padding-left: 8px;';

    let idx = 1;
    for (const sys of systemSet) {
      const sysEl = document.createElement('div');
      sysEl.setAttribute('data-highlight', 'true');
      sysEl.style.cssText = 'margin-bottom: 2px;';
      sysEl.textContent = `${idx}. ${sys}`;
      systemList.appendChild(sysEl);
      idx++;
    }

    this.systemsEl.appendChild(systemList);
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

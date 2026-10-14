import { getLocalPlayer, type World } from '../ecs';
import { eventBus } from '../core/events/EventBus';
import type { CombatSpecialization } from '#shared';

/** A small guide for the standalone grove trial. The full game keeps its existing HUD. */
export class GroveOverlay {
  private element = document.createElement('aside');
  private progress: HTMLElement;
  private controls: HTMLElement;
  private energy: HTMLElement;
  private grazerDown = false;
  private serpentDown = false;
  private unsubscribe: Array<() => void> = [];
  constructor(
    private world: World,
    restart: (spec: CombatSpecialization) => void
  ) {
    this.element.style.cssText =
      'position:fixed;left:24px;top:22px;z-index:500;color:#c8dfd5;font:12px/1.6 monospace;background:rgba(7,20,21,.88);border:1px solid #34534c;border-radius:8px;padding:16px 20px;max-width:290px;box-shadow:0 8px 36px #0005';
    this.element.innerHTML =
      '<div style="font-size:10px;letter-spacing:3px;color:#89a99c">STAGE 03 · HUNTING TRIAL</div><div style="font-size:20px;letter-spacing:1px;color:#e9d8a3;margin:4px 0 10px">The Lantern Grove</div><div data-progress></div><div data-energy style="color:#72c9af;margin-top:10px"></div><div data-controls style="color:#9dada7;margin-top:8px"></div><div data-restart style="display:flex;gap:5px;margin-top:12px"></div>';
    this.progress = this.element.querySelector('[data-progress]')!;
    this.controls = this.element.querySelector('[data-controls]')!;
    this.energy = this.element.querySelector('[data-energy]')!;
    for (const spec of ['melee', 'ranged', 'traps'] as const) {
      const button = document.createElement('button');
      button.textContent = `Try ${spec}`;
      button.title = `Return to the entrance with full energy as ${spec}`;
      button.style.cssText =
        'background:#18352f;color:#c8dfd5;border:1px solid #41675b;border-radius:4px;padding:5px 8px;font:11px monospace;cursor:pointer';
      button.onclick = () => {
        restart(spec);
      };
      this.element.querySelector('[data-restart]')!.append(button);
    }
    this.unsubscribe.push(
      eventBus.on('jungleCreatureKilled', (event) => {
        if (event.killerId === getLocalPlayer(this.world)?.id) this.grazerDown = true;
      }),
      eventBus.on('entropySerpentKilled', (event) => {
        if (event.serpentId === 'grove-serpent') this.serpentDown = true;
      })
    );
    document.body.append(this.element);
  }
  update(): void {
    const player = getLocalPlayer(this.world);
    if (!player) {
      this.element.style.display = 'none';
      return;
    }
    this.element.style.display = 'block';
    this.progress.textContent = this.serpentDown
      ? 'Hunt complete. The grove is yours.'
      : this.grazerDown
        ? 'Follow the root trail east. Bait the serpent, leave its amber strike zone, then attack during recovery.'
        : 'Follow the pale roots east. Gather lantern fruit and hunt the copper grazer in the clearing.';
    this.energy.textContent = `ENERGY ${Math.round(player.energy).toLocaleString()} / ${player.maxEnergy.toLocaleString()}`;
    const spec = player.specialization;
    this.controls.textContent = `WASD move · SHIFT sprint · ${spec === 'melee' ? 'LMB swipe · RMB thrust' : spec === 'traps' ? 'LMB / RMB plant a mine' : 'LMB fire'} · ${spec?.toUpperCase() ?? 'CHOOSE YOUR PATH'}`;
  }
  dispose(): void {
    this.unsubscribe.forEach((fn) => fn());
    this.element.remove();
  }
}

// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { InputManager } from '../InputManager';
import { eventBus } from '../../events/EventBus';
import { EvolutionStage } from '#shared';

let manager: InputManager | undefined;
let unsubscribe: (() => void) | undefined;
afterEach(() => {
  manager?.dispose();
  unsubscribe?.();
  document.body.innerHTML = '';
});

function setup() {
  manager = new InputManager();
  manager.setCameraProjection({
    screenToWorld: (x, y) => ({ x, y }),
    worldToScreen: (x, y) => ({ x, y }),
  });
  manager.setPlayerStateProvider({
    getStage: () => EvolutionStage.CYBER_ORGANISM,
    getSpecialization: () => 'melee',
  });
  const attacks: Array<{ attackType: string; targetX: number; targetY: number }> = [];
  unsubscribe = eventBus.on('client:meleeAttack', (e) => attacks.push(e));
  return attacks;
}

function press(target: EventTarget, button = 0) {
  target.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button, clientX: 320, clientY: 200 })
  );
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button }));
}

describe('combat click capture', () => {
  it.each([0, 2])(
    'retains a complete button %i click between frames and fires only once',
    (button) => {
      const attacks = setup();
      press(window, button);
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900, clientY: 600 }));
      manager!.update(16);
      manager!.update(16);
      expect(attacks).toEqual([
        expect.objectContaining({
          attackType: button === 0 ? 'swipe' : 'thrust',
          targetX: 320,
          targetY: 200,
        }),
      ]);
    }
  );

  it('does not turn a trial button click into an attack', () => {
    const attacks = setup();
    const button = document.createElement('button');
    document.body.append(button);
    press(button);
    manager!.update(16);
    expect(attacks).toHaveLength(0);
  });
});

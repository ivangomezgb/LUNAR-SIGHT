import { describe, expect, it } from 'vitest';
import { actionOf, letterOf, warpStepOf } from '../controls';

describe('game keyboard mapping', () => {
  it('maps W A S D and the arrows by physical key, whatever the layout or Caps Lock', () => {
    expect(actionOf({ code: 'KeyW', key: 'W' })).toBe('up');
    expect(actionOf({ code: 'KeyW', key: 'z' })).toBe('up'); // AZERTY: the key in the W position
    expect(actionOf({ code: 'KeyA', key: 'A' })).toBe('left');
    expect(actionOf({ code: 'ArrowRight', key: 'ArrowRight' })).toBe('right');
    expect(actionOf({ code: 'Space', key: ' ' })).toBe('thrust');
    expect(actionOf({ key: 's' })).toBe('down'); // no code (old browsers): the character
  });
  it('leaves browser shortcuts alone', () => {
    expect(actionOf({ code: 'KeyW', key: 'w', ctrlKey: true })).toBeNull();
    expect(actionOf({ code: 'KeyQ', key: 'q' })).toBeNull();
  });
  it('time warp works with [ ] and with − + (no AltGr needed)', () => {
    expect(warpStepOf({ key: '-' })).toBe(-1);
    expect(warpStepOf({ key: '+' })).toBe(1);
    expect(warpStepOf({ key: '[' })).toBe(-1);
    expect(warpStepOf({ code: 'NumpadAdd', key: '+' })).toBe(1);
    expect(warpStepOf({ key: 'x' })).toBe(0);
  });
  it('letter shortcuts follow the physical key', () => {
    expect(letterOf({ code: 'KeyE', key: 'E' })).toBe('e');
    expect(letterOf({ key: 'P' })).toBe('p');
  });
});

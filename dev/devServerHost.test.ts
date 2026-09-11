import { describe, expect, it } from 'vitest';
import { LAN_HMR_PORT, LOOPBACK_HOST, isLanOptIn, resolveDevServerExposure } from './devServerHost';

const LAN_IP = '192.168.1.42';

describe('resolveDevServerExposure', () => {
  it('binds loopback with default HMR when nothing is set', () => {
    const exposure = resolveDevServerExposure({});
    expect(exposure.host).toBe(LOOPBACK_HOST);
    expect(exposure.hmr).toBeUndefined();
    expect(exposure.lanEnabled).toBe(false);
    expect(exposure.warning).toBeNull();
  });

  it('stays on loopback when TAURI_DEV_HOST is set without an opt-in flag', () => {
    const exposure = resolveDevServerExposure({ TAURI_DEV_HOST: LAN_IP });
    expect(exposure.host).toBe(LOOPBACK_HOST);
    expect(exposure.hmr).toBeUndefined();
    expect(exposure.lanEnabled).toBe(false);
    expect(exposure.warning).toBeNull();
  });

  it('stays on loopback when the opt-in flag is set but no LAN host is known', () => {
    const exposure = resolveDevServerExposure({ PORTPAL_ALLOW_LAN: '1' });
    expect(exposure.host).toBe(LOOPBACK_HOST);
    expect(exposure.hmr).toBeUndefined();
    expect(exposure.lanEnabled).toBe(false);
  });

  it.each(['PORTPAL_ALLOW_LAN', 'TAURI_DEV_LAN'])(
    'binds the LAN host when %s opts in alongside TAURI_DEV_HOST',
    (flag) => {
      const exposure = resolveDevServerExposure({ TAURI_DEV_HOST: LAN_IP, [flag]: '1' });
      expect(exposure.host).toBe(LAN_IP);
      expect(exposure.hmr).toEqual({ protocol: 'ws', host: LAN_IP, port: LAN_HMR_PORT });
      expect(exposure.lanEnabled).toBe(true);
      expect(exposure.warning).toContain(LAN_IP);
      expect(exposure.warning).toContain(String(LAN_HMR_PORT));
      expect(exposure.warning).toMatch(/trusted network/i);
    },
  );

  it('ignores falsy and unset opt-in values', () => {
    for (const value of [undefined, '', ' ', '0', 'false', 'no']) {
      expect(isLanOptIn({ PORTPAL_ALLOW_LAN: value })).toBe(false);
      expect(
        resolveDevServerExposure({ TAURI_DEV_HOST: LAN_IP, PORTPAL_ALLOW_LAN: value }).host,
      ).toBe(LOOPBACK_HOST);
    }
  });

  it('accepts common truthy spellings of the opt-in flag', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ', 'on']) {
      expect(isLanOptIn({ PORTPAL_ALLOW_LAN: value })).toBe(true);
    }
  });

  it('treats a blank TAURI_DEV_HOST as no LAN host', () => {
    const exposure = resolveDevServerExposure({ TAURI_DEV_HOST: '   ', PORTPAL_ALLOW_LAN: '1' });
    expect(exposure.host).toBe(LOOPBACK_HOST);
    expect(exposure.lanEnabled).toBe(false);
  });
});

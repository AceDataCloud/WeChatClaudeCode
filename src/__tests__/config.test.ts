import { describe, expect, it } from 'vitest';
import { ensurePermissionModeConfig, type Config } from '../config.js';

describe('ensurePermissionModeConfig', () => {
  it('sets bypassPermissions when permission mode is missing', () => {
    const config: Config = {
      workingDirectory: '/tmp/work'
    };

    const normalized = ensurePermissionModeConfig(config);

    expect(normalized.permissionMode).toBe('bypassPermissions');
    expect(normalized.permissionModeExplicit).toBe(true);
  });

  it('migrates legacy explicit flag to true and keeps bypassPermissions', () => {
    const config: Config = {
      workingDirectory: '/tmp/work',
      permissionMode: 'plan',
      permissionModeExplicit: false
    };

    const normalized = ensurePermissionModeConfig(config);

    expect(normalized.permissionMode).toBe('bypassPermissions');
    expect(normalized.permissionModeExplicit).toBe(true);
  });

  it('keeps explicit modern configuration unchanged', () => {
    const config: Config = {
      workingDirectory: '/tmp/work',
      permissionMode: 'acceptEdits',
      permissionModeExplicit: true
    };

    const normalized = ensurePermissionModeConfig(config);

    expect(normalized.permissionMode).toBe('acceptEdits');
    expect(normalized.permissionModeExplicit).toBe(true);
  });
});

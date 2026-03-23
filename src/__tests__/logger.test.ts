import { describe, expect, it } from 'vitest';
import { redact } from '../logger.js';

describe('redact', () => {
  it('masks bearer tokens in plain text', () => {
    const result = redact('Authorization: Bearer abc.def.ghi');

    expect(result).toContain('Bearer ***');
    expect(result).not.toContain('abc.def.ghi');
  });

  it('masks token-like fields in JSON payloads', () => {
    const payload = {
      token: 'top-secret-token',
      api_key: 'api-key-value',
      nested: {
        password: 'pass123'
      }
    };

    const result = redact(payload);

    expect(result).toContain('"token": "***"');
    expect(result).toContain('"api_key": "***"');
    expect(result).toContain('"password": "***"');
    expect(result).not.toContain('top-secret-token');
  });
});

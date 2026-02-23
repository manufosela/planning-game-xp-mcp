import { describe, it, expect, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');

describe('firebase.js — resolveCredentialsPath', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use GOOGLE_APPLICATION_CREDENTIALS when set', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/custom/path/service.json';
    delete process.env.MCP_INSTANCE_DIR;

    const { resolveCredentialsPath } = await import('../src/firebase.js?t=gac-' + Date.now());
    const result = resolveCredentialsPath();

    expect(result).toBe(resolve('/custom/path/service.json'));
  });

  it('should prefer GOOGLE_APPLICATION_CREDENTIALS over MCP_INSTANCE_DIR', async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/explicit/credentials.json';
    process.env.MCP_INSTANCE_DIR = '/tmp/test-instances/pro';

    const { resolveCredentialsPath } = await import('../src/firebase.js?t=gac-over-instance-' + Date.now());
    const result = resolveCredentialsPath();

    expect(result).toBe(resolve('/explicit/credentials.json'));
  });

  it('should fall back to engine root when no env vars set and instance file missing', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.MCP_INSTANCE_DIR;

    const { resolveCredentialsPath } = await import('../src/firebase.js?t=fallback-' + Date.now());
    const result = resolveCredentialsPath();

    expect(result).toBe(resolve(engineRoot, 'serviceAccountKey.json'));
  });

  it('should fall back to engine root when MCP_INSTANCE_DIR set but file missing', async () => {
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.MCP_INSTANCE_DIR = '/tmp/nonexistent-instance-dir-' + Date.now();

    const { resolveCredentialsPath } = await import('../src/firebase.js?t=instance-missing-' + Date.now());
    const result = resolveCredentialsPath();

    expect(result).toBe(resolve(engineRoot, 'serviceAccountKey.json'));
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const engineRoot = resolve(__dirname, '..');

describe('user.js — resolveUserConfigPath', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should resolve to engine root when MCP_INSTANCE_DIR is not set', async () => {
    delete process.env.MCP_INSTANCE_DIR;

    // Dynamic import to re-evaluate with current env
    const { resolveUserConfigPath } = await import('../src/user.js?t=no-instance-' + Date.now());
    const result = resolveUserConfigPath();

    expect(result).toBe(resolve(engineRoot, 'mcp.user.json'));
  });

  it('should resolve to instance dir when MCP_INSTANCE_DIR is set', async () => {
    process.env.MCP_INSTANCE_DIR = '/tmp/test-instances/pro';

    const { resolveUserConfigPath } = await import('../src/user.js?t=with-instance-' + Date.now());
    const result = resolveUserConfigPath();

    expect(result).toBe(resolve('/tmp/test-instances/pro', 'mcp.user.json'));
  });

  it('should handle MCP_INSTANCE_DIR with trailing slash', async () => {
    process.env.MCP_INSTANCE_DIR = '/tmp/test-instances/personal/';

    const { resolveUserConfigPath } = await import('../src/user.js?t=trailing-slash-' + Date.now());
    const result = resolveUserConfigPath();

    expect(result).toBe(resolve('/tmp/test-instances/personal/', 'mcp.user.json'));
  });
});

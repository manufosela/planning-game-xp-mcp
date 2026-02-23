import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to mcp.user.json.
 * Priority: MCP_INSTANCE_DIR/mcp.user.json > engine root/mcp.user.json
 */
export function resolveUserConfigPath() {
  const instanceDir = process.env.MCP_INSTANCE_DIR;
  if (instanceDir) {
    return resolve(instanceDir, 'mcp.user.json');
  }
  return resolve(__dirname, '..', 'mcp.user.json');
}

export const USER_CONFIG_PATH = resolveUserConfigPath();

let mcpUser = null;
let loaded = false;

/**
 * Load user config from mcp.user.json
 * Expected format:
 * {
 *   "developerId": "dev_010",
 *   "stakeholderId": "stk_014",
 *   "name": "Mánu Fosela",
 *   "email": "mfosela@geniova.com"
 * }
 */
function loadUser() {
  if (loaded) return;
  loaded = true;

  try {
    const raw = readFileSync(USER_CONFIG_PATH, 'utf8');
    mcpUser = JSON.parse(raw);
  } catch {
    mcpUser = null;
  }
}

/**
 * Check if mcp.user.json exists and is configured
 */
export function isMcpUserConfigured() {
  loadUser();
  return mcpUser !== null && !!mcpUser.developerId;
}

/**
 * Get the full MCP user object, or null if not configured
 */
export function getMcpUser() {
  loadUser();
  return mcpUser;
}

/**
 * Get the user identifier for createdBy/updatedBy fields.
 * Returns email if available, otherwise 'geniova-mcp'.
 */
export function getMcpUserId() {
  loadUser();
  if (mcpUser && mcpUser.email) return mcpUser.email;
  return 'geniova-mcp';
}

/**
 * Write mcp.user.json with the provided user data.
 * Resets the loaded cache so next read picks up new data.
 */
export function writeMcpUser(userData) {
  writeFileSync(USER_CONFIG_PATH, JSON.stringify(userData, null, 2) + '\n', 'utf8');
  // Reset cache
  mcpUser = userData;
  loaded = true;
}

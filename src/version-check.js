import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import { getDatabase, getFirebaseProjectId } from './firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

// Firebase path for MCP version info
const MCP_VERSION_PATH = '/data/mcp';

// Cache for version check result
let versionCheckResult = null;
let hasNotifiedInSession = false;

/**
 * Get local version from package.json
 * @returns {string} Local version
 */
export function getLocalVersion() {
  try {
    const packagePath = join(ROOT_DIR, 'package.json');
    const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
    return packageJson.version;
  } catch (error) {
    return 'unknown';
  }
}

/**
 * Get remote version from Firebase (fast, works for private repos)
 * @returns {Promise<string|null>} Remote version or null if not found
 */
async function getRemoteVersionFromFirebase() {
  try {
    const db = getDatabase();
    const snapshot = await db.ref(`${MCP_VERSION_PATH}/latestVersion`).once('value');
    return snapshot.val() || null;
  } catch (error) {
    return null;
  }
}

/**
 * Update latest version in Firebase (call after successful git push)
 * @param {string} version - Version to set
 * @returns {Promise<boolean>} Success
 */
export async function setLatestVersionInFirebase(version) {
  try {
    const db = getDatabase();
    await db.ref(MCP_VERSION_PATH).update({
      latestVersion: version,
      updatedAt: new Date().toISOString()
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get remote version using git (fallback, slower)
 * @returns {Promise<string|null>} Remote version or null if fetch fails
 */
async function getRemoteVersionFromGit() {
  try {
    // Fetch latest from origin (silently)
    execSync('git fetch origin main --quiet', {
      cwd: ROOT_DIR,
      timeout: 10000,
      stdio: 'pipe'
    });

    // Get package.json from remote main branch
    const remotePackageJson = execSync('git show origin/main:package.json', {
      cwd: ROOT_DIR,
      timeout: 5000,
      encoding: 'utf-8'
    });

    const packageData = JSON.parse(remotePackageJson);
    return packageData.version;
  } catch (error) {
    return null;
  }
}

/**
 * Get remote version (tries Firebase first, then git)
 * @returns {Promise<string|null>} Remote version or null
 */
async function getRemoteVersion() {
  // Try Firebase first (fast)
  let version = await getRemoteVersionFromFirebase();
  if (version) return version;

  // Fallback to git (slower, but more reliable)
  return await getRemoteVersionFromGit();
}

/**
 * Check if local has uncommitted changes
 * @returns {boolean}
 */
function hasLocalChanges() {
  try {
    const status = execSync('git status --porcelain', {
      cwd: ROOT_DIR,
      encoding: 'utf-8'
    });
    return status.trim().length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Get commits behind origin/main
 * @returns {number}
 */
function getCommitsBehind() {
  try {
    const behind = execSync('git rev-list HEAD..origin/main --count', {
      cwd: ROOT_DIR,
      encoding: 'utf-8'
    });
    return parseInt(behind.trim(), 10) || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Compare semantic versions
 * @param {string} local - Local version
 * @param {string} remote - Remote version
 * @returns {boolean} True if remote is newer
 */
function isNewerVersion(local, remote) {
  if (!local || !remote || local === 'unknown') return false;

  const localParts = local.split('.').map(Number);
  const remoteParts = remote.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const l = localParts[i] || 0;
    const r = remoteParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }

  return false;
}

/**
 * Check for updates and return result
 * @param {boolean} forceRefresh - Force refresh cache
 * @returns {Promise<{hasUpdate: boolean, localVersion: string, remoteVersion: string|null, message: string|null}>}
 */
export async function checkForUpdates(forceRefresh = false) {
  // Return cached result if available and not forcing refresh
  if (versionCheckResult !== null && !forceRefresh) {
    return versionCheckResult;
  }

  const localVersion = getLocalVersion();
  const remoteVersion = await getRemoteVersion();
  const commitsBehind = remoteVersion ? getCommitsBehind() : 0;

  const hasUpdate = remoteVersion !== null && isNewerVersion(localVersion, remoteVersion);

  versionCheckResult = {
    hasUpdate,
    localVersion,
    remoteVersion,
    commitsBehind,
    message: hasUpdate
      ? `⚠️ planning-game-mcp v${remoteVersion} disponible (actual: v${localVersion}, ${commitsBehind} commits atrás). Usa update_mcp para actualizar.`
      : null
  };

  return versionCheckResult;
}

/**
 * Check for updates at startup and log to stderr
 */
export async function checkVersionAtStartup() {
  const result = await checkForUpdates();

  if (result.hasUpdate && result.message) {
    console.error(result.message);
  }
}

/**
 * Get update notice for tool response (only once per session)
 * @returns {string|null} Update notice or null
 */
export function getUpdateNoticeOnce() {
  if (hasNotifiedInSession || !versionCheckResult?.hasUpdate) {
    return null;
  }

  hasNotifiedInSession = true;
  return versionCheckResult.message;
}

/**
 * Reset the notification flag (useful after update)
 */
export function resetNotificationFlag() {
  hasNotifiedInSession = false;
  versionCheckResult = null;
}

/**
 * Get MCP status including version info
 * @returns {Promise<object>} Status object
 */
export async function getMcpStatus() {
  const result = await checkForUpdates(true); // Force refresh
  const localChanges = hasLocalChanges();

  const instanceDir = process.env.MCP_INSTANCE_DIR || null;
  const instanceName = instanceDir ? instanceDir.split('/').pop() : null;

  return {
    name: 'planning-game-mcp',
    instanceName,
    instanceDir,
    firebaseProjectId: getFirebaseProjectId(),
    localVersion: result.localVersion,
    remoteVersion: result.remoteVersion,
    commitsBehind: result.commitsBehind || 0,
    updateAvailable: result.hasUpdate,
    hasLocalChanges: localChanges,
    updateMessage: result.message,
    updateCommand: result.hasUpdate ? 'Use update_mcp tool to update' : null,
    repositoryPath: ROOT_DIR
  };
}

/**
 * Update MCP by pulling from origin
 * @returns {Promise<object>} Update result
 */
export async function updateMcp() {
  const localChanges = hasLocalChanges();

  if (localChanges) {
    return {
      success: false,
      error: 'Cannot update: you have local uncommitted changes. Commit or stash them first.',
      hasLocalChanges: true
    };
  }

  try {
    // Pull latest changes
    const pullResult = execSync('git pull origin main', {
      cwd: ROOT_DIR,
      encoding: 'utf-8',
      timeout: 30000
    });

    // Reset cache
    resetNotificationFlag();

    // Get new version
    const newVersion = getLocalVersion();

    return {
      success: true,
      message: `MCP actualizado a v${newVersion}. IMPORTANTE: Reinicia la sesión de Claude para cargar la nueva versión.`,
      pullOutput: pullResult.trim(),
      newVersion,
      requiresRestart: true
    };
  } catch (error) {
    return {
      success: false,
      error: `Error al actualizar: ${error.message}`,
      suggestion: 'Intenta manualmente: cd ' + ROOT_DIR + ' && git pull'
    };
  }
}

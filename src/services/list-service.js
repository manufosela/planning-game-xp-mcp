import { getDatabase } from '../firebase.js';

/**
 * Hardcoded fallback lists - used when Firebase is unavailable
 */
const FALLBACK_LISTS = {
  bugPriority: {
    'APPLICATION BLOCKER': 1,
    'DEPARTMENT BLOCKER': 2,
    'INDIVIDUAL BLOCKER': 3,
    'USER EXPERIENCE ISSUE': 4,
    'WORKFLOW IMPROVEMENT': 5,
    'WORKAROUND AVAILABLE ISSUE': 6
  },
  bugStatus: {
    'Created': 1,
    'Assigned': 2,
    'Fixed': 3,
    'Verified': 4,
    'Closed': 5
  },
  taskStatus: {
    'To Do': 1,
    'In Progress': 2,
    'To Validate': 3,
    'Done&Validated': 4,
    'Blocked': 5,
    'Reopened': 6
  }
};

/**
 * Firebase RTDB paths for each list type
 */
const LIST_PATHS = {
  bugPriority: '/data/bugpriorityList',
  bugStatus: '/data/statusList/bug-card',
  taskStatus: '/data/statusList/task-card'
};

/**
 * Cache for loaded lists
 * Each entry: { data: Object, loadedAt: number }
 */
const cache = {};

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Load a list from Firebase RTDB
 * @param {string} listType - One of: bugPriority, bugStatus, taskStatus
 * @returns {Promise<Object>} The list as { text: order } or { text: order } object
 */
async function loadListFromFirebase(listType) {
  const path = LIST_PATHS[listType];
  if (!path) {
    throw new Error(`Unknown list type: "${listType}". Valid types: ${Object.keys(LIST_PATHS).join(', ')}`);
  }

  try {
    const db = getDatabase();
    const snapshot = await db.ref(path).once('value');
    const data = snapshot.val();

    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      return data;
    }

    console.error(`[ListService] WARNING: Empty or null data at ${path}, using fallback`);
    return FALLBACK_LISTS[listType];
  } catch (error) {
    console.error(`[ListService] WARNING: Failed to load ${path}: ${error.message}, using fallback`);
    return FALLBACK_LISTS[listType];
  }
}

/**
 * Get a list, using cache if available and not expired
 * @param {string} listType - One of: bugPriority, bugStatus, taskStatus
 * @returns {Promise<Object>} The list as { text: order } object
 */
async function getList(listType) {
  const cached = cache[listType];
  if (cached && (Date.now() - cached.loadedAt) < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await loadListFromFirebase(listType);
  cache[listType] = { data, loadedAt: Date.now() };
  return data;
}

/**
 * Get a sorted array of text values for a list type
 * @param {string} listType - One of: bugPriority, bugStatus, taskStatus
 * @returns {Promise<string[]>} Sorted array of text values
 */
export async function getListTexts(listType) {
  const data = await getList(listType);
  return Object.entries(data)
    .sort((a, b) => a[1] - b[1])
    .map(([text]) => text);
}

/**
 * Get a list as array of {id, text} pairs, sorted by order
 * The "id" is the key in Firebase, the "text" is the same key (since keys ARE the text labels)
 * @param {string} listType - One of: bugPriority, bugStatus, taskStatus
 * @returns {Promise<Array<{id: string, text: string, order: number}>>}
 */
export async function getListPairs(listType) {
  const data = await getList(listType);
  return Object.entries(data)
    .sort((a, b) => a[1] - b[1])
    .map(([text, order]) => ({ id: text, text, order }));
}

/**
 * Validate that a value exists in a list
 * @param {string} listType - One of: bugPriority, bugStatus, taskStatus
 * @param {string} value - Value to validate
 * @returns {Promise<boolean>}
 */
export async function isValidValue(listType, value) {
  const data = await getList(listType);
  return value in data;
}

/**
 * Resolve a value to ensure it's valid for the given list type.
 * Accepts the text value and returns it if valid.
 * @param {string} listType - One of: bugPriority, bugStatus, taskStatus
 * @param {string} value - Text value to resolve
 * @returns {Promise<string>} The resolved value
 * @throws {Error} If value cannot be resolved
 */
export async function resolveValue(listType, value) {
  const data = await getList(listType);

  // Direct match (value is a known key)
  if (value in data) {
    return value;
  }

  // Case-insensitive match
  const lowerValue = value.toLowerCase();
  for (const key of Object.keys(data)) {
    if (key.toLowerCase() === lowerValue) {
      return key;
    }
  }

  const validValues = Object.keys(data).join(', ');
  throw new Error(
    `Invalid ${listType} value "${value}". Valid values are: ${validValues}`
  );
}

/**
 * Invalidate cache for a specific list or all lists
 * @param {string} [listType] - If provided, only invalidate this list. Otherwise invalidate all.
 */
export function invalidateCache(listType) {
  if (listType) {
    delete cache[listType];
  } else {
    for (const key of Object.keys(cache)) {
      delete cache[key];
    }
  }
}

/**
 * Get the fallback list for a given type (for backwards compatibility)
 * @param {string} listType
 * @returns {Object}
 */
export function getFallbackList(listType) {
  return FALLBACK_LISTS[listType] || {};
}

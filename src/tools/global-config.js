import { z } from 'zod';
import { getDatabase } from '../firebase.js';

/**
 * Valid config types
 */
export const VALID_CONFIG_TYPES = ['agents', 'prompts', 'instructions'];

/**
 * Valid categories
 */
export const VALID_CATEGORIES = ['development', 'planning', 'qa', 'documentation', 'architecture'];

/**
 * Schema for listing global configs
 */
export const listGlobalConfigSchema = z.object({
  type: z.enum(['agents', 'prompts', 'instructions']).describe('Config type'),
  category: z.string().optional().describe('Filter by category')
});

/**
 * Schema for getting a single global config
 */
export const getGlobalConfigSchema = z.object({
  type: z.enum(['agents', 'prompts', 'instructions']).describe('Config type'),
  configId: z.string().describe('Config ID (the Firebase key)')
});

/**
 * Schema for creating a global config
 */
export const createGlobalConfigSchema = z.object({
  type: z.enum(['agents', 'prompts', 'instructions']).describe('Config type'),
  name: z.string().describe('Config name'),
  description: z.string().optional().describe('Config description'),
  content: z.string().optional().describe('Config content'),
  category: z.string().optional().describe('Category (default: "development")')
});

/**
 * Schema for updating a global config
 */
export const updateGlobalConfigSchema = z.object({
  type: z.enum(['agents', 'prompts', 'instructions']).describe('Config type'),
  configId: z.string().describe('Config ID'),
  updates: z.record(z.unknown()).describe('Fields to update')
});

/**
 * Schema for deleting a global config
 */
export const deleteGlobalConfigSchema = z.object({
  type: z.enum(['agents', 'prompts', 'instructions']).describe('Config type'),
  configId: z.string().describe('Config ID')
});

/**
 * List all configs of a type
 */
export async function listGlobalConfig({ type, category }) {
  const db = getDatabase();
  const configsRef = db.ref(`global/${type}`);
  const snapshot = await configsRef.once('value');
  const configsData = snapshot.val();

  if (!configsData) {
    return { content: [{ type: 'text', text: `No ${type} found.` }] };
  }

  let configs = Object.entries(configsData).map(([configId, config]) => ({
    configId,
    ...config
  }));

  // Filter by category if provided
  if (category) {
    configs = configs.filter(c => c.category === category);
  }

  // Sort by name
  configs.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  const summary = configs.map(c => ({
    configId: c.configId,
    name: c.name,
    description: c.description || '',
    category: c.category || 'development',
    createdAt: c.createdAt,
    createdBy: c.createdBy
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(summary, null, 2)
    }]
  };
}

/**
 * Get a single config
 */
export async function getGlobalConfig({ type, configId }) {
  const db = getDatabase();
  const configRef = db.ref(`global/${type}/${configId}`);
  const snapshot = await configRef.once('value');

  if (!snapshot.exists()) {
    return { content: [{ type: 'text', text: `Config "${configId}" not found in ${type}.` }] };
  }

  const config = {
    configId,
    type,
    ...snapshot.val()
  };

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(config, null, 2)
    }]
  };
}

/**
 * Create a new config
 */
export async function createGlobalConfig({ type, name, description, content, category }) {
  const db = getDatabase();

  // Validate category if provided
  const configCategory = category || 'development';
  if (!VALID_CATEGORIES.includes(configCategory)) {
    throw new Error(`Invalid category "${configCategory}". Valid categories: ${VALID_CATEGORIES.join(', ')}`);
  }

  const configsRef = db.ref(`global/${type}`);
  const newConfigRef = configsRef.push();
  const configId = newConfigRef.key;
  const now = new Date().toISOString();

  const configData = {
    name,
    description: description || '',
    content: content || '',
    category: configCategory,
    createdAt: now,
    createdBy: 'geniova-mcp',
    updatedAt: now,
    updatedBy: 'geniova-mcp'
  };

  await newConfigRef.set(configData);

  // Save history
  await saveConfigHistory(db, type, configId, configData, 'create');

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: `${type.slice(0, -1)} created successfully`,
        configId,
        type,
        name,
        category: configCategory
      }, null, 2)
    }]
  };
}

/**
 * Update an existing config
 */
export async function updateGlobalConfig({ type, configId, updates }) {
  const db = getDatabase();
  const configRef = db.ref(`global/${type}/${configId}`);

  // Verify config exists
  const snapshot = await configRef.once('value');
  if (!snapshot.exists()) {
    throw new Error(`Config "${configId}" not found in ${type}.`);
  }

  // Validate category if being updated
  if (updates.category !== undefined && !VALID_CATEGORIES.includes(updates.category)) {
    throw new Error(`Invalid category "${updates.category}". Valid categories: ${VALID_CATEGORIES.join(', ')}`);
  }

  // Prevent updating protected fields
  const protectedFields = ['configId', 'type', 'createdAt', 'createdBy'];
  const protectedFieldsInUpdate = protectedFields.filter(field => field in updates);
  for (const field of protectedFieldsInUpdate) {
    throw new Error(`Cannot update protected field: "${field}"`);
  }

  // Add metadata
  updates.updatedAt = new Date().toISOString();
  updates.updatedBy = 'geniova-mcp';

  await configRef.update(updates);

  // Get updated config
  const updatedSnapshot = await configRef.once('value');
  const updatedConfig = updatedSnapshot.val();

  // Save history
  await saveConfigHistory(db, type, configId, updatedConfig, 'update');

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: `${type.slice(0, -1)} updated successfully`,
        config: { configId, type, ...updatedConfig }
      }, null, 2)
    }]
  };
}

/**
 * Delete a config
 */
export async function deleteGlobalConfig({ type, configId }) {
  const db = getDatabase();
  const configRef = db.ref(`global/${type}/${configId}`);

  // Verify config exists
  const snapshot = await configRef.once('value');
  if (!snapshot.exists()) {
    throw new Error(`Config "${configId}" not found in ${type}.`);
  }

  const configData = snapshot.val();

  // Move to trash
  const trashRef = db.ref(`global-trash/${type}/${configId}`);
  await trashRef.set({
    ...configData,
    deletedAt: new Date().toISOString(),
    deletedBy: 'geniova-mcp'
  });

  // Save history
  await saveConfigHistory(db, type, configId, configData, 'delete');

  // Delete from main location
  await configRef.remove();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: `${type.slice(0, -1)} deleted successfully`,
        configId,
        type
      }, null, 2)
    }]
  };
}

/**
 * Save config history entry
 */
async function saveConfigHistory(db, type, configId, configData, action) {
  try {
    const historyRef = db.ref(`global-history/${type}/${configId}`);
    const newHistoryRef = historyRef.push();

    await newHistoryRef.set({
      name: configData.name,
      description: configData.description,
      content: configData.content,
      category: configData.category,
      timestamp: new Date().toISOString(),
      changedBy: 'geniova-mcp',
      action: action
    });
  } catch (error) {
    console.error('Error saving config history:', error);
    // Don't throw - history is secondary
  }
}

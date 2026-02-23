import { z } from 'zod';
import { getDatabase } from '../firebase.js';

export const listStakeholdersSchema = z.object({
  projectId: z.string().optional().describe('Filter stakeholders by project ID')
});

/**
 * List all stakeholders with their IDs, names and emails
 * @param {Object} params - { projectId? }
 */
export async function listStakeholders({ projectId } = {}) {
  const db = getDatabase();

  // Read from /data/stakeholders which contains the global stakeholder IDs (stk_XXX)
  const snapshot = await db.ref('/data/stakeholders').once('value');
  const stakeholdersData = snapshot.val();

  if (!stakeholdersData) {
    return { content: [{ type: 'text', text: 'No stakeholders found.' }] };
  }

  // Handle both new format { stk_XXX: { name, email } } and legacy format { name: email }
  let stakeholders = [];

  for (const [key, value] of Object.entries(stakeholdersData)) {
    if (!value) continue;

    // New format: stk_XXX -> { name, email, active, teamId }
    if (key.startsWith('stk_') && typeof value === 'object') {
      if (value.active === false) continue; // Skip inactive
      stakeholders.push({
        id: key,
        name: value.name || '',
        email: value.email || '',
        teamId: value.teamId || null
      });
    }
    // Legacy format: "Name" -> "email@domain.com"
    else if (typeof value === 'string') {
      stakeholders.push({
        id: key, // In legacy format, key is the name
        name: key,
        email: value
      });
    }
  }

  // If projectId filter is provided, filter by project stakeholders
  if (projectId) {
    const projectSnapshot = await db.ref(`/projects/${projectId}/stakeholders`).once('value');
    const projectStakeholders = projectSnapshot.val();

    if (projectStakeholders && Array.isArray(projectStakeholders)) {
      stakeholders = stakeholders.filter(s => projectStakeholders.includes(s.id));
    }
  }

  // Sort by name
  stakeholders.sort((a, b) => a.name.localeCompare(b.name));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(stakeholders, null, 2)
    }]
  };
}

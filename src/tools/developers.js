import { z } from 'zod';
import { getDatabase } from '../firebase.js';

export const listDevelopersSchema = z.object({
  projectId: z.string().optional().describe('Filter developers by project ID')
});

/**
 * List all developers with their IDs, names and emails
 * @param {Object} params - { projectId? }
 */
export async function listDevelopers({ projectId } = {}) {
  const db = getDatabase();

  // Read from /data/developers which contains the global developer IDs (dev_XXX)
  const snapshot = await db.ref('/data/developers').once('value');
  const developersData = snapshot.val();

  let developers = [];

  if (developersData) {
    // Transform { dev_XXX: { name, email, active } } to array
    for (const [id, data] of Object.entries(developersData)) {
      if (!data) continue;
      if (data.active === false) continue; // Exclude inactive developers

      developers.push({
        id,
        name: data.name || '',
        email: data.email || ''
      });
    }
  }

  // If no centralized developers found, try to extract from projects
  if (developers.length === 0) {
    const projectsSnapshot = await db.ref('/projects').once('value');
    const projectsData = projectsSnapshot.val();

    if (projectsData) {
      const seenEmails = new Set();

      for (const [projId, proj] of Object.entries(projectsData)) {
        if (!proj.developers) continue;

        for (const dev of proj.developers) {
          if (!dev || !dev.email) continue;
          const email = dev.email.toLowerCase().trim();
          if (seenEmails.has(email)) continue;
          seenEmails.add(email);

          developers.push({
            id: email, // Use email as ID when no centralized data
            name: dev.name || '',
            email: email
          });
        }
      }
    }
  }

  // If projectId filter is provided, filter by project developers
  if (projectId && developers.length > 0) {
    // Check if project has developer IDs array
    const projectSnapshot = await db.ref(`/projects/${projectId}/developers`).once('value');
    const projectDevelopers = projectSnapshot.val();

    if (projectDevelopers) {
      // Handle both array of IDs and array of objects
      if (Array.isArray(projectDevelopers)) {
        // Could be ["dev_001", "dev_002"] or [{name, email}, ...]
        const isObjectArray = projectDevelopers.length > 0 && typeof projectDevelopers[0] === 'object';

        if (isObjectArray) {
          // Filter by email match
          const projectEmails = new Set(projectDevelopers.map(d => d.email?.toLowerCase().trim()).filter(Boolean));
          developers = developers.filter(d => projectEmails.has(d.email.toLowerCase()));
        } else {
          // Filter by ID match
          const projectIds = new Set(projectDevelopers);
          developers = developers.filter(d => projectIds.has(d.id));
        }
      }
    }
  }

  if (developers.length === 0) {
    return { content: [{ type: 'text', text: 'No developers found.' }] };
  }

  // Sort by name
  developers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(developers, null, 2)
    }]
  };
}

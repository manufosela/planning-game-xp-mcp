import { z } from 'zod';
import { getDatabase, getFirestore } from '../firebase.js';
import { getMcpUser, getMcpUserId } from '../user.js';
import { buildSectionPath, getAbbrId, SECTION_MAP } from '../utils.js';

export const listProjectsSchema = z.object({});

export const getProjectSchema = z.object({
  projectId: z.string().describe('Project ID (e.g., "PlanningGame", "Cinema4D")')
});

export const updateProjectSchema = z.object({
  projectId: z.string().describe('Project ID to update'),
  updates: z.record(z.unknown()).describe('Fields to update (e.g., { description: "...", repoUrl: "..." })')
});

export const createProjectSchema = z.object({
  projectId: z.string().describe('Project ID (e.g., "MiProyecto"). Will be used as the database key'),
  name: z.string().describe('Display name of the project'),
  abbreviation: z.string().describe('Short abbreviation for card IDs (e.g., "MPR" for MiProyecto)'),
  description: z.string().optional().describe('Project description'),
  version: z.string().optional().describe('Project version (e.g., "1.0.0")'),
  scoringSystem: z.enum(['1-5', 'fibonacci']).optional().describe('Scoring system for points (default: "1-5")'),
  repoUrl: z.string().optional().describe('Repository URL'),
  languages: z.array(z.string()).optional().describe('Programming languages used'),
  frameworks: z.array(z.string()).optional().describe('Frameworks used')
});

export async function listProjects() {
  const db = getDatabase();
  const snapshot = await db.ref('/projects').once('value');
  const projects = snapshot.val();

  if (!projects) {
    return { content: [{ type: 'text', text: 'No projects found.' }] };
  }

  const result = Object.entries(projects).map(([id, project]) => {
    const developers = extractDevelopers(project.developers);
    return {
      id,
      name: project.name || id,
      abbreviation: project.abbreviation || null,
      scoringSystem: project.scoringSystem || null,
      developers,
      createdAt: project.createdAt || null
    };
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

export async function getProject({ projectId }) {
  const db = getDatabase();
  const snapshot = await db.ref(`/projects/${projectId}`).once('value');
  const project = snapshot.val();

  if (!project) {
    return { content: [{ type: 'text', text: `Project "${projectId}" not found.` }] };
  }

  // Return all project fields
  const result = {
    id: projectId,
    name: project.name || projectId,
    abbreviation: project.abbreviation || null,
    description: project.description || null,
    version: project.version || null,
    changelog: project.changelog || [],
    scoringSystem: project.scoringSystem || null,
    repoUrl: project.repoUrl || null,
    languages: project.languages || [],
    frameworks: project.frameworks || [],
    developers: extractDevelopers(project.developers),
    stakeholders: extractStakeholders(project.stakeholders),
    agentsGuidelines: project.agentsGuidelines || null,
    iaEnabled: project.iaEnabled || false,
    allowExecutables: project.allowExecutables || false,
    archived: project.archived || false,
    order: project.order || null,
    createdAt: project.createdAt || null,
    createdBy: project.createdBy || null,
    updatedAt: project.updatedAt || null,
    updatedBy: project.updatedBy || null
  };

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

export async function updateProject({ projectId, updates }) {
  const db = getDatabase();
  const projectRef = db.ref(`/projects/${projectId}`);

  // Verify project exists
  const snapshot = await projectRef.once('value');
  if (!snapshot.exists()) {
    throw new Error(`Project "${projectId}" not found.`);
  }

  const currentProject = snapshot.val();

  // Prevent updating protected fields
  const protectedFields = ['name', 'createdAt', 'createdBy'];
  for (const field of protectedFields) {
    if (field in updates) {
      throw new Error(`Cannot update protected field: "${field}". Use project rename feature in UI if needed.`);
    }
  }

  // Filter out undefined values (Firebase doesn't accept undefined)
  const cleanUpdates = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  // Auto-update changelog when version changes
  if (cleanUpdates.version && cleanUpdates.version !== currentProject.version) {
    const newVersion = cleanUpdates.version;
    const changes = cleanUpdates.changelogEntry || cleanUpdates.changes || [];
    const changelogEntry = {
      version: newVersion,
      date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      changes: Array.isArray(changes) ? changes : [changes],
      updatedBy: getMcpUserId()
    };

    // Get existing changelog or create new array
    const existingChangelog = currentProject.changelog || [];

    // Prepend new entry (newest first)
    cleanUpdates.changelog = [changelogEntry, ...existingChangelog];

    // Remove temporary fields that shouldn't be stored
    delete cleanUpdates.changelogEntry;
    delete cleanUpdates.changes;
  }

  // Add metadata
  cleanUpdates.updatedAt = new Date().toISOString();
  cleanUpdates.updatedBy = getMcpUserId();

  await projectRef.update(cleanUpdates);

  // Return updated project
  const updatedSnapshot = await projectRef.once('value');
  const updatedProject = updatedSnapshot.val();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'Project updated successfully',
        project: {
          id: projectId,
          ...updatedProject
        }
      }, null, 2)
    }]
  };
}

/**
 * Default team member IDs to auto-assign to new projects
 */
const DEFAULT_DEVELOPERS = ['dev_010', 'dev_016']; // Mánu Fosela, BecarIA
const DEFAULT_STAKEHOLDERS = ['stk_014'];           // Mánu Fosela

/**
 * Resolve default team members from the database
 */
async function resolveDefaultTeam(db) {
  const warnings = [];

  // Resolve developers
  const developers = [];
  for (const devId of DEFAULT_DEVELOPERS) {
    const devSnapshot = await db.ref(`/data/developers/${devId}`).once('value');
    const devData = devSnapshot.val();
    if (devData) {
      developers.push({ id: devId, name: devData.name || '', email: devData.email || '' });
    } else {
      warnings.push({ code: 'DEFAULT_MEMBER_NOT_FOUND', message: `Default developer "${devId}" not found in /data/developers` });
    }
  }

  // Resolve stakeholders (stored as ID array in projects)
  const stakeholders = [];
  for (const stkId of DEFAULT_STAKEHOLDERS) {
    const stkSnapshot = await db.ref(`/data/stakeholders/${stkId}`).once('value');
    const stkData = stkSnapshot.val();
    if (stkData) {
      stakeholders.push(stkId);
    } else {
      warnings.push({ code: 'DEFAULT_MEMBER_NOT_FOUND', message: `Default stakeholder "${stkId}" not found in /data/stakeholders` });
    }
  }

  return { developers, stakeholders, warnings };
}

export async function createProject({ projectId, name, abbreviation, description, version, scoringSystem, repoUrl, languages, frameworks }) {
  const db = getDatabase();
  const firestore = getFirestore();
  const projectRef = db.ref(`/projects/${projectId}`);
  const mcpUserId = getMcpUserId();

  // Check if project already exists
  const snapshot = await projectRef.once('value');
  if (snapshot.exists()) {
    throw new Error(`Project "${projectId}" already exists.`);
  }

  // Resolve default team members
  const { developers, stakeholders, warnings } = await resolveDefaultTeam(db);

  // Add MCP user as developer if not already in the list
  const mcpUser = getMcpUser();
  if (mcpUser && mcpUser.developerId) {
    const alreadyInList = developers.some(d => d.id === mcpUser.developerId);
    if (!alreadyInList) {
      // Fetch full developer data from database
      const devSnapshot = await db.ref(`/data/developers/${mcpUser.developerId}`).once('value');
      const devData = devSnapshot.val();
      if (devData) {
        developers.push({ id: mcpUser.developerId, name: devData.name || mcpUser.name || '', email: devData.email || mcpUser.email || '' });
      } else {
        // Use data from mcp.user.json directly
        developers.push({ id: mcpUser.developerId, name: mcpUser.name || '', email: mcpUser.email || '' });
      }
    }
  }

  // Create project object
  const project = {
    name,
    abbreviation,
    description: description || null,
    version: version || '1.0.0',
    changelog: version ? [{
      version: version,
      date: new Date().toISOString().split('T')[0],
      changes: ['Initial release'],
      updatedBy: mcpUserId
    }] : [],
    scoringSystem: scoringSystem || '1-5',
    repoUrl: repoUrl || null,
    languages: languages || [],
    frameworks: frameworks || [],
    developers,
    stakeholders,
    iaEnabled: true,
    allowExecutables: false,
    archived: false,
    createdAt: new Date().toISOString(),
    createdBy: mcpUserId
  };

  await projectRef.set(project);

  // Create default [MANTENIMIENTO] epic
  const epicSectionPath = buildSectionPath(projectId, 'epic');
  const sectionAbbr = getAbbrId(SECTION_MAP['epic']);
  const counterKey = `${abbreviation}-${sectionAbbr}`;
  const counterRef = firestore.collection('projectCounters').doc(counterKey);

  const epicId = await firestore.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(counterRef);
    let lastId = 0;
    if (docSnap.exists) {
      lastId = docSnap.data().lastId || 0;
    }
    const newId = lastId + 1;
    transaction.set(counterRef, { lastId: newId }, { merge: true });
    return `${counterKey}-${newId.toString().padStart(4, '0')}`;
  });

  const epicRef = db.ref(epicSectionPath).push();
  await epicRef.set({
    cardId: epicId,
    cardType: 'epic-card',
    group: 'epics',
    projectId,
    title: '[MANTENIMIENTO]',
    description: 'Épica por defecto para tareas de mantenimiento del proyecto.',
    status: 'To Do',
    priority: 'Medium',
    year: new Date().getFullYear(),
    createdAt: new Date().toISOString(),
    createdBy: mcpUserId,
    firebaseId: epicRef.key
  });

  const response = {
    message: 'Project created successfully',
    projectId,
    project,
    defaultEpic: {
      cardId: epicId,
      title: '[MANTENIMIENTO]'
    }
  };

  if (warnings.length > 0) {
    response.warnings = warnings;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}

function extractDevelopers(developers) {
  if (!developers) return [];

  if (Array.isArray(developers)) {
    return developers.map(d => ({ id: d.id || null, name: d.name, email: d.email }));
  }

  // Object format: { "Name": "email" } or { "Name": { email, name } }
  return Object.entries(developers).map(([key, value]) => {
    if (typeof value === 'string') {
      return { id: null, name: key, email: value };
    }
    return { id: value.id || null, name: value.name || key, email: value.email || '' };
  });
}

function extractStakeholders(stakeholders) {
  if (!stakeholders) return [];

  if (Array.isArray(stakeholders)) {
    return stakeholders.map(s => ({ id: s.id || null, name: s.name, email: s.email }));
  }

  // Object format
  return Object.entries(stakeholders).map(([key, value]) => {
    if (typeof value === 'string') {
      return { id: null, name: key, email: value };
    }
    return { id: value.id || null, name: value.name || key, email: value.email || '' };
  });
}

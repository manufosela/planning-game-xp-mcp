import { z } from 'zod';
import { getDatabase, getFirestore } from '../firebase.js';
import { buildSectionPath, SECTION_MAP, CARD_TYPE_MAP, GROUP_MAP, getAbbrId } from '../utils.js';

export const listSprintsSchema = z.object({
  projectId: z.string().describe('Project ID (e.g., "Cinema4D", "Intranet")'),
  year: z.number().optional().describe('Filter by year')
});

export const createSprintSchema = z.object({
  projectId: z.string().describe('Project ID'),
  title: z.string().describe('Sprint title'),
  startDate: z.string().describe('Sprint start date (YYYY-MM-DD)'),
  endDate: z.string().describe('Sprint end date (YYYY-MM-DD)'),
  year: z.number().optional().describe('Year (default: extracted from startDate)'),
  status: z.string().optional().describe('Sprint status (default: "Planning")'),
  devPoints: z.number().optional().describe('Total dev points planned'),
  businessPoints: z.number().optional().describe('Total business points planned')
});

export const updateSprintSchema = z.object({
  projectId: z.string().describe('Project ID'),
  firebaseId: z.string().describe('Firebase key of the sprint'),
  updates: z.record(z.unknown()).describe('Fields to update')
});

export const getSprintSchema = z.object({
  projectId: z.string().describe('Project ID'),
  cardId: z.string().describe('Sprint card ID (e.g., "GSP-SPR-0001")')
});

export async function listSprints({ projectId, year }) {
  const db = getDatabase();
  const sectionPath = buildSectionPath(projectId, 'sprint');
  const snapshot = await db.ref(sectionPath).once('value');
  const sprintsData = snapshot.val();

  if (!sprintsData) {
    return { content: [{ type: 'text', text: `No sprints found in project "${projectId}".` }] };
  }

  let sprints = Object.entries(sprintsData).map(([firebaseId, sprint]) => ({
    firebaseId,
    cardId: sprint.cardId,
    title: sprint.title,
    status: sprint.status,
    startDate: sprint.startDate || null,
    endDate: sprint.endDate || null,
    year: sprint.year || null,
    devPoints: sprint.devPoints || null,
    businessPoints: sprint.businessPoints || null
  }));

  if (year) {
    sprints = sprints.filter(s => s.year === year);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(sprints, null, 2)
    }]
  };
}

export async function getSprint({ projectId, cardId }) {
  const db = getDatabase();
  const sectionPath = buildSectionPath(projectId, 'sprint');
  const snapshot = await db.ref(sectionPath).once('value');
  const sprintsData = snapshot.val();

  if (!sprintsData) {
    return { content: [{ type: 'text', text: `No sprints found in project "${projectId}".` }] };
  }

  for (const [firebaseId, sprint] of Object.entries(sprintsData)) {
    if (sprint.cardId === cardId) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ firebaseId, ...sprint }, null, 2)
        }]
      };
    }
  }

  return { content: [{ type: 'text', text: `Sprint "${cardId}" not found in project "${projectId}".` }] };
}

export async function createSprint({ projectId, title, startDate, endDate, year, status, devPoints, businessPoints }) {
  const db = getDatabase();
  const firestore = getFirestore();

  // Get project abbreviation
  const abbrSnapshot = await db.ref(`/projects/${projectId}/abbreviation`).once('value');
  const projectAbbr = abbrSnapshot.val();
  if (!projectAbbr) {
    throw new Error(`Project "${projectId}" has no abbreviation configured.`);
  }

  // Generate sprint ID using Firestore counter
  const sectionKey = SECTION_MAP['sprint'];
  const sectionAbbr = getAbbrId(sectionKey);
  const counterKey = `${projectAbbr}-${sectionAbbr}`;
  const counterRef = firestore.collection('projectCounters').doc(counterKey);

  const cardId = await firestore.runTransaction(async (transaction) => {
    const docSnap = await transaction.get(counterRef);
    let lastId = 0;

    if (docSnap.exists) {
      lastId = docSnap.data().lastId || 0;
    }

    const newId = lastId + 1;
    transaction.set(counterRef, { lastId: newId }, { merge: true });

    const newIdStr = newId.toString().padStart(4, '0');
    return `${counterKey}-${newIdStr}`;
  });

  // Extract year from startDate if not provided
  const sprintYear = year || parseInt(startDate.split('-')[0], 10);

  // Build sprint data
  const sectionPath = buildSectionPath(projectId, 'sprint');
  const newSprintRef = db.ref(sectionPath).push();

  const sprintData = {
    cardId,
    cardType: CARD_TYPE_MAP['sprint'],
    group: GROUP_MAP['sprint'],
    projectId,
    title,
    startDate,
    endDate,
    year: sprintYear,
    status: status || 'Planning',
    createdAt: new Date().toISOString(),
    createdBy: 'geniova-mcp',
    firebaseId: newSprintRef.key
  };

  if (devPoints !== undefined) sprintData.devPoints = devPoints;
  if (businessPoints !== undefined) sprintData.businessPoints = businessPoints;

  await newSprintRef.set(sprintData);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'Sprint created successfully',
        cardId,
        firebaseId: newSprintRef.key,
        projectId,
        startDate,
        endDate
      }, null, 2)
    }]
  };
}

export async function updateSprint({ projectId, firebaseId, updates }) {
  const db = getDatabase();
  const sectionPath = buildSectionPath(projectId, 'sprint');
  const sprintRef = db.ref(`${sectionPath}/${firebaseId}`);

  // Verify sprint exists
  const snapshot = await sprintRef.once('value');
  if (!snapshot.exists()) {
    throw new Error(`Sprint with firebaseId "${firebaseId}" not found in project "${projectId}".`);
  }

  // Prevent updating protected fields
  const protectedFields = ['cardId', 'firebaseId', 'cardType', 'group', 'projectId'];
  for (const field of protectedFields) {
    if (field in updates) {
      throw new Error(`Cannot update protected field: "${field}"`);
    }
  }

  // Add metadata
  updates.updatedAt = new Date().toISOString();
  updates.updatedBy = 'geniova-mcp';

  await sprintRef.update(updates);

  // Return updated sprint
  const updatedSnapshot = await sprintRef.once('value');

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: 'Sprint updated successfully',
        sprint: updatedSnapshot.val()
      }, null, 2)
    }]
  };
}

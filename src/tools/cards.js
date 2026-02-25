import { z } from 'zod';
import { getDatabase, getFirestore } from '../firebase.js';
import { SECTION_MAP, CARD_TYPE_MAP, GROUP_MAP, getAbbrId, buildSectionPath } from '../utils.js';
import { validateCommitsField, appendCommitsToCard } from './commits-validation.js';
import { getMcpUser } from '../user.js';
import { getListTexts, getListPairs, resolveValue, isValidValue } from '../services/list-service.js';

/**
 * Generate all possible ratios for a scoring system and map to priorities
 * @param {string} scoringSystem - "1-5" or "fibonacci"
 * @returns {Array<{biz: number, dev: number, ratio: number, priority: number}>} Sorted by ratio descending
 */
export function generatePriorityMap(scoringSystem = '1-5') {
  const values = scoringSystem === 'fibonacci'
    ? [1, 2, 3, 5, 8, 13]
    : [1, 2, 3, 4, 5];

  const combinations = [];
  for (const biz of values) {
    for (const dev of values) {
      const ratio = (biz / dev) * 100;
      combinations.push({ biz, dev, ratio });
    }
  }

  // Sort by ratio descending and assign priority
  combinations.sort((a, b) => b.ratio - a.ratio);
  return combinations.map((c, index) => ({
    ...c,
    priority: index + 1
  }));
}

// Pre-calculate priority maps for both systems
export const PRIORITY_MAP_1_5 = generatePriorityMap('1-5');       // 25 combinations
export const PRIORITY_MAP_FIBONACCI = generatePriorityMap('fibonacci'); // 36 combinations

/**
 * Calculate priority using Planning Game formula
 * @param {number} businessPoints
 * @param {number} devPoints
 * @param {string} scoringSystem - "1-5" or "fibonacci"
 * @returns {number|null} Priority (1 = highest) or null if can't calculate
 */
export function calculatePriority(businessPoints, devPoints, scoringSystem = '1-5') {
  if (!businessPoints || !devPoints || devPoints === 0) {
    return null;
  }

  const ratio = (businessPoints / devPoints) * 100;
  const map = scoringSystem === 'fibonacci' ? PRIORITY_MAP_FIBONACCI : PRIORITY_MAP_1_5;

  // Find the priority corresponding to the closest ratio
  for (const entry of map) {
    if (ratio >= entry.ratio) {
      return entry.priority;
    }
  }

  return map.length; // Last priority if ratio is less than all
}

/**
 * Validate that a sprint exists in the project
 * @param {string} projectId - Project ID
 * @param {string} sprint - Sprint cardId to validate
 * @throws {Error} If sprint doesn't exist
 */
export async function validateSprintExists(projectId, sprint) {
  if (!sprint) return; // Sprint is optional in some cases

  const db = getDatabase();
  const sprintSectionPath = buildSectionPath(projectId, 'sprint');
  const snapshot = await db.ref(sprintSectionPath).once('value');
  const sprintsData = snapshot.val();

  if (!sprintsData) {
    throw new Error(
      `No sprints found in project "${projectId}". ` +
      `Create a sprint first using create_sprint.`
    );
  }

  const sprintExists = Object.values(sprintsData).some(s => s.cardId === sprint);
  if (!sprintExists) {
    const availableSprints = Object.values(sprintsData)
      .map(s => `${s.cardId} (${s.title})`)
      .join(', ');
    throw new Error(
      `Sprint "${sprint}" not found in project "${projectId}". ` +
      `Available sprints: ${availableSprints}. ` +
      `Use list_sprints to see full details.`
    );
  }
}

/**
 * Get the active sprint for a project
 * Priority: 1) Sprint with status "Active" or "In Progress"
 *           2) Sprint whose dates include today
 * @param {string} projectId - Project ID
 * @returns {Promise<Object|null>} Active sprint data or null
 */
export async function getActiveSprint(projectId) {
  const db = getDatabase();
  const sprintSectionPath = buildSectionPath(projectId, 'sprint');
  const snapshot = await db.ref(sprintSectionPath).once('value');
  const sprintsData = snapshot.val();

  if (!sprintsData) {
    return null;
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const sprints = Object.entries(sprintsData).map(([firebaseId, sprint]) => ({
    firebaseId,
    ...sprint
  }));

  // Priority 1: Find sprint with status "Active" or "In Progress"
  const activeBySatus = sprints.find(s =>
    s.status === 'Active' || s.status === 'In Progress'
  );
  if (activeBySatus) {
    return activeBySatus;
  }

  // Priority 2: Find sprint whose dates include today
  const activeByDate = sprints.find(s => {
    if (!s.startDate || !s.endDate) return false;
    return s.startDate <= today && today <= s.endDate;
  });
  if (activeByDate) {
    return activeByDate;
  }

  return null;
}

/**
 * Valid statuses for bugs
 */
export const VALID_BUG_STATUSES = ['Created', 'Assigned', 'Fixed', 'Verified', 'Closed'];

/**
 * Valid priorities for bugs
 */
export const VALID_BUG_PRIORITIES = [
  'Application Blocker',
  'Department Blocker',
  'Individual Blocker',
  'User Experience Issue',
  'Workaround Available Issue',
  'Workflow Improvement'
];

/**
 * Valid statuses for tasks
 */
export const VALID_TASK_STATUSES = ['To Do', 'In Progress', 'To Validate', 'Done&Validated', 'Blocked', 'Reopened'];

/**
 * Valid priorities for tasks
 */
export const VALID_TASK_PRIORITIES = ['High', 'Medium', 'Low'];

/**
 * Default values by card type
 */
export const TYPE_DEFAULTS = {
  bug: {
    status: 'Created',
    priority: 'User Experience Issue'
  },
  task: {
    status: 'To Do',
    priority: 'Medium'
  },
  epic: {
    status: 'To Do',
    priority: 'Medium'
  },
  proposal: {
    status: 'To Do',
    priority: 'Medium'
  },
  qa: {
    status: 'To Do',
    priority: 'Medium'
  }
};

/**
 * Valid ID prefixes for entity references
 */
export const VALID_ID_PREFIXES = {
  developer: 'dev_',
  codeveloper: 'dev_',
  validator: 'stk_',  // Validators are stakeholders
  stakeholder: 'stk_'
};

/**
 * Validate entity ID format (developer, validator, stakeholder)
 * @param {string} field - Field name
 * @param {string} value - Field value
 * @throws {Error} If validation fails
 */
export function validateEntityId(field, value) {
  if (!value) return; // Empty values are allowed (optional fields)

  const prefix = VALID_ID_PREFIXES[field];
  if (!prefix) return; // Unknown field, skip validation

  if (!value.startsWith(prefix)) {
    throw new Error(
      `Invalid ${field} ID "${value}". ` +
      `${field.charAt(0).toUpperCase() + field.slice(1)} IDs must start with "${prefix}".`
    );
  }
}

/**
 * Validate all entity IDs in data object
 * @param {Object} data - Data containing entity IDs
 * @throws {Error} If any validation fails
 */
export function validateEntityIds(data) {
  for (const field of Object.keys(VALID_ID_PREFIXES)) {
    if (data[field] !== undefined) {
      validateEntityId(field, data[field]);
    }
  }
}

/**
 * Collect entity ID validation issues without throwing
 * @param {Object} data - Data to validate
 * @returns {Object[]} Array of validation errors
 */
export function collectEntityIdIssues(data) {
  const errors = [];

  for (const field of Object.keys(VALID_ID_PREFIXES)) {
    if (data[field] !== undefined && data[field]) {
      const prefix = VALID_ID_PREFIXES[field];
      if (!data[field].startsWith(prefix)) {
        errors.push({
          code: 'INVALID_ENTITY_ID',
          field,
          message: `Invalid ${field} ID "${data[field]}". ${field.charAt(0).toUpperCase() + field.slice(1)} IDs must start with "${prefix}".`,
          expectedPrefix: prefix,
          actualValue: data[field]
        });
      }
    }
  }

  return errors;
}

/**
 * Required fields when closing a bug
 */
export const REQUIRED_FIELDS_TO_CLOSE_BUG = ['commits', 'rootCause', 'resolution'];

/**
 * Validate bug fields (status, priority) using dynamic lists from Firebase
 * @param {Object} data - Card data to validate
 * @param {boolean} isUpdate - Whether this is an update operation
 * @throws {Error} If validation fails
 */
export async function validateBugFields(data, isUpdate = false) {
  // Validate and resolve status if provided
  if (data.status !== undefined) {
    try {
      data.status = await resolveValue('bugStatus', data.status);
    } catch {
      const validStatuses = await getListTexts('bugStatus');
      throw new Error(
        `Invalid bug status "${data.status}". ` +
        `Valid bug statuses are: ${validStatuses.join(', ')}`
      );
    }
  }

  // Validate and resolve priority if provided
  if (data.priority !== undefined) {
    try {
      data.priority = await resolveValue('bugPriority', data.priority);
    } catch {
      const validPriorities = await getListTexts('bugPriority');
      throw new Error(
        `Invalid bug priority "${data.priority}". ` +
        `Valid bug priorities are: ${validPriorities.join(', ')}`
      );
    }
  }
}

/**
 * Validate bug status transitions
 * When closing a bug, requires: commits, rootCause, resolution
 * @param {Object} currentBug - Current bug data
 * @param {Object} updates - Proposed updates
 * @throws {Error} If validation fails
 */
export function validateBugStatusTransition(currentBug, updates) {
  const newStatus = updates.status;
  if (!newStatus) return; // No status change

  const currentStatus = currentBug.status;
  if (currentStatus === newStatus) return; // Same status

  // When closing a bug, require documentation of the fix
  if (newStatus === 'Closed') {
    const finalBug = { ...currentBug, ...updates };
    const missingFields = [];

    // Check commits
    const hasCommits = Array.isArray(finalBug.commits) && finalBug.commits.length > 0;
    if (!hasCommits) {
      missingFields.push('commits (list of commits that fixed the bug)');
    }

    // Check rootCause
    if (!finalBug.rootCause || (typeof finalBug.rootCause === 'string' && finalBug.rootCause.trim() === '')) {
      missingFields.push('rootCause (why the bug occurred)');
    }

    // Check resolution
    if (!finalBug.resolution || (typeof finalBug.resolution === 'string' && finalBug.resolution.trim() === '')) {
      missingFields.push('resolution (how the bug was fixed)');
    }

    if (missingFields.length > 0) {
      throw new Error(
        `Cannot close bug: missing required fields: ${missingFields.join(', ')}. ` +
        'When closing a bug, you must document the commits, root cause, and resolution.'
      );
    }
  }
}

/**
 * Validate task fields (status, priority)
 * @param {Object} data - Card data to validate
 * @param {boolean} isUpdate - Whether this is an update operation
 * @throws {Error} If validation fails
 */
export async function validateTaskFields(data, isUpdate = false) {
  // Validate and resolve status if provided
  if (data.status !== undefined) {
    try {
      data.status = await resolveValue('taskStatus', data.status);
    } catch {
      const validStatuses = await getListTexts('taskStatus');
      throw new Error(
        `Invalid task status "${data.status}". ` +
        `Valid task statuses are: ${validStatuses.join(', ')}`
      );
    }
  }

  // Validate priority if provided (for tasks, priority is usually calculated)
  if (data.priority !== undefined) {
    if (!VALID_TASK_PRIORITIES.includes(data.priority)) {
      throw new Error(
        `Invalid task priority "${data.priority}". ` +
        `Valid task priorities are: ${VALID_TASK_PRIORITIES.join(', ')}`
      );
    }
  }
}

/**
 * Apply type-specific defaults and auto-fields
 * @param {string} type - Card type
 * @param {Object} data - Card data
 * @returns {Object} - Data with defaults applied
 */
export function applyTypeDefaults(type, data) {
  const defaults = TYPE_DEFAULTS[type] || {};
  const result = { ...data };

  // Apply status default if not provided
  if (!result.status) {
    result.status = defaults.status;
  }

  // Apply priority default if not provided
  if (!result.priority) {
    result.priority = defaults.priority;
  }

  // Bug-specific: add registerDate if not provided
  if (type === 'bug' && !result.registerDate) {
    result.registerDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  return result;
}

export const listCardsSchema = z.object({
  projectId: z.string().describe('Project ID (e.g., "Cinema4D", "Intranet")'),
  type: z.enum(['task', 'bug', 'epic', 'proposal', 'qa']).describe('Card type to list'),
  status: z.string().optional().describe('Filter by status (e.g., "To Do", "In Progress", "Done&Validated")'),
  sprint: z.string().optional().describe('Filter by sprint name'),
  developer: z.string().optional().describe('Filter by developer name'),
  year: z.number().optional().describe('Filter by year')
});

export const getCardSchema = z.object({
  projectId: z.string().describe('Project ID'),
  cardId: z.string().describe('Card ID (e.g., "C4D-TSK-0042")')
});

export const getTransitionRulesSchema = z.object({
  type: z.enum(['task', 'bug']).optional().describe('Card type (default: task)')
});

/**
 * Schema for descriptionStructured user story format
 */
export const descriptionStructuredItemSchema = z.object({
  role: z.string().describe('User role (Como...)'),
  goal: z.string().describe('What the user wants (Quiero...)'),
  benefit: z.string().describe('Why they want it (Para...)')
});

/**
 * Schema for acceptanceCriteriaStructured (Gherkin-style scenarios)
 */
export const acceptanceCriteriaItemSchema = z.object({
  given: z.string().optional().describe('Given: Initial context/preconditions'),
  when: z.string().optional().describe('When: Action or event'),
  then: z.string().optional().describe('Then: Expected outcome'),
  raw: z.string().optional().describe('Raw text format if not using Given/When/Then')
});

/**
 * Valid statuses for implementation plan steps
 */
export const VALID_STEP_STATUSES = ['pending', 'in_progress', 'done'];

/**
 * Valid statuses for the overall implementation plan
 */
export const VALID_PLAN_STATUSES = ['pending', 'proposed', 'validated', 'in_progress', 'completed'];

/**
 * Schema for implementation plan steps
 */
export const implementationPlanStepSchema = z.object({
  description: z.string().describe('What is done in this step'),
  files: z.string().optional().describe('Affected files (comma-separated paths)'),
  status: z.enum(['pending', 'in_progress', 'done']).optional().describe('Step status (default: pending)')
});

/**
 * Schema for implementationPlan (pre-implementation planning)
 */
export const implementationPlanSchema = z.object({
  approach: z.string().describe('Technical approach chosen and why'),
  steps: z.array(implementationPlanStepSchema).optional().describe('Implementation steps, each step = 1 potential commit'),
  dataModelChanges: z.string().optional().describe('Data model changes (Firestore, RTDB, etc.)'),
  apiChanges: z.string().optional().describe('API/endpoints/Cloud Functions changes'),
  risks: z.string().optional().describe('Identified risks'),
  outOfScope: z.string().optional().describe('What is explicitly NOT included'),
  planStatus: z.enum(['pending', 'proposed', 'validated', 'in_progress', 'completed']).optional().describe('Plan status (default: pending)')
});

/**
 * Migrate legacy implementationPlan (string) to new structure
 * @param {any} plan - The implementationPlan value
 * @returns {Object|null} Migrated plan or null
 */
export function migrateImplementationPlan(plan) {
  if (!plan) return null;

  // Already an object, return as-is
  if (typeof plan === 'object' && !Array.isArray(plan)) {
    return plan;
  }

  // Legacy string format - migrate to new structure
  if (typeof plan === 'string' && plan.trim() !== '') {
    return {
      approach: plan,
      steps: [],
      dataModelChanges: '',
      apiChanges: '',
      risks: '',
      outOfScope: '',
      planStatus: 'proposed'
    };
  }

  return null;
}

/**
 * Validate implementationPlan structure
 * @param {Object} plan - The plan to validate
 * @returns {Object} Validation result with valid flag and errors
 */
export function validateImplementationPlan(plan) {
  const errors = [];

  if (!plan || typeof plan !== 'object') {
    return { valid: true, errors: [] }; // Empty plan is valid
  }

  // approach is required if plan is provided
  if (!plan.approach || (typeof plan.approach === 'string' && plan.approach.trim() === '')) {
    errors.push({
      code: 'MISSING_APPROACH',
      message: 'implementationPlan.approach is required when providing an implementation plan'
    });
  }

  // Validate planStatus if provided
  if (plan.planStatus && !VALID_PLAN_STATUSES.includes(plan.planStatus)) {
    errors.push({
      code: 'INVALID_PLAN_STATUS',
      message: `Invalid planStatus "${plan.planStatus}". Valid values: ${VALID_PLAN_STATUSES.join(', ')}`
    });
  }

  // Validate steps if provided
  if (plan.steps) {
    if (!Array.isArray(plan.steps)) {
      errors.push({
        code: 'INVALID_STEPS',
        message: 'implementationPlan.steps must be an array'
      });
    } else {
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        if (!step.description || (typeof step.description === 'string' && step.description.trim() === '')) {
          errors.push({
            code: 'MISSING_STEP_DESCRIPTION',
            message: `implementationPlan.steps[${i}].description is required`
          });
        }
        if (step.status && !VALID_STEP_STATUSES.includes(step.status)) {
          errors.push({
            code: 'INVALID_STEP_STATUS',
            message: `Invalid step status "${step.status}" at index ${i}. Valid values: ${VALID_STEP_STATUSES.join(', ')}`
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export const createCardSchema = z.object({
  projectId: z.string().describe('Project ID'),
  type: z.enum(['task', 'bug', 'epic', 'proposal', 'qa']).describe('Card type to create'),
  title: z.string().describe('Card title'),
  description: z.string().optional().describe('Card description (legacy - use descriptionStructured for tasks)'),
  descriptionStructured: z.array(descriptionStructuredItemSchema).optional().describe('Structured user story format: [{role: "Como...", goal: "Quiero...", benefit: "Para..."}]. REQUIRED for tasks.'),
  acceptanceCriteria: z.string().optional().describe('Acceptance criteria as plain text. REQUIRED for tasks (use this OR acceptanceCriteriaStructured).'),
  acceptanceCriteriaStructured: z.array(acceptanceCriteriaItemSchema).optional().describe('Acceptance criteria in Gherkin format: [{given: "...", when: "...", then: "..."}]. REQUIRED for tasks (use this OR acceptanceCriteria).'),
  epic: z.string().optional().describe('Epic ID (e.g., "PRJ-EPC-0001"). REQUIRED for tasks - must reference an existing epic in the project.'),
  implementationPlan: implementationPlanSchema.optional().describe('Pre-implementation plan. Recommended for tasks with devPoints >= 3 or complex tasks. Must include approach and at least 1 step.'),
  status: z.string().optional().describe('Card status (default: "To Do")'),
  priority: z.string().optional().describe('Card priority. For bugs/epics: "High", "Medium", "Low". For tasks: DO NOT SET - calculated automatically from devPoints/businessPoints using Planning Game formula.'),
  developer: z.string().optional().describe('Developer ID (must start with "dev_")'),
  codeveloper: z.string().optional().describe('Co-developer ID (must start with "dev_"). Auto-assigned from mcp.user.json when AI (BecarIA) is the developer.'),
  validator: z.string().optional().describe('Validator/Stakeholder ID (must start with "stk_"). If not provided for tasks, auto-assigned: 1) developer if also stakeholder, 2) Mánu Fosela, 3) error with available stakeholders.'),
  sprint: z.string().optional().describe('Sprint ID (e.g., "PRJ-SPR-0001"). Must reference an existing sprint in the project.'),
  devPoints: z.number().optional().describe('Development points (1-5 or fibonacci). Used to calculate task priority.'),
  businessPoints: z.number().optional().describe('Business points (1-5 or fibonacci). Used to calculate task priority.'),
  year: z.number().optional().describe('Year (default: current year)')
});

export const updateCardSchema = z.object({
  projectId: z.string().describe('Project ID'),
  type: z.enum(['task', 'bug', 'epic', 'proposal', 'sprint', 'qa']).describe('Card type'),
  firebaseId: z.string().describe('Firebase key of the card (the RTDB push ID)'),
  updates: z.record(z.unknown()).describe('Fields to update (e.g., { status: "In Progress", developer: "Name" })'),
  validateOnly: z.boolean().optional().describe('If true, only validate the update without applying it. Returns missing fields and validation errors.')
});

export async function listCards({ projectId, type, status, sprint, developer, year }) {
  const db = getDatabase();
  const sectionPath = buildSectionPath(projectId, type);
  const snapshot = await db.ref(sectionPath).once('value');
  const cardsData = snapshot.val();

  if (!cardsData) {
    return { content: [{ type: 'text', text: `No ${type} cards found in project "${projectId}".` }] };
  }

  let cards = Object.entries(cardsData).map(([firebaseId, card]) => ({
    firebaseId,
    ...card
  }));

  if (status) {
    cards = cards.filter(c => c.status === status);
  }
  if (sprint) {
    cards = cards.filter(c => c.sprint === sprint);
  }
  if (developer) {
    cards = cards.filter(c => c.developer === developer);
  }
  if (year) {
    cards = cards.filter(c => c.year === year);
  }

  const summary = cards.map(c => ({
    firebaseId: c.firebaseId,
    cardId: c.cardId,
    title: c.title,
    status: c.status,
    priority: c.priority,
    developer: c.developer || null,
    sprint: c.sprint || null,
    year: c.year || null
  }));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(summary, null, 2)
    }]
  };
}

export async function getCard({ projectId, cardId }) {
  const db = getDatabase();

  // Determine card type from the cardId format (e.g., C4D-TSK-0042 → task)
  const typePart = cardId.split('-')[1];
  const typeMap = { TSK: 'task', BUG: 'bug', EPC: 'epic', PRP: 'proposal', SPR: 'sprint', _QA: 'qa' };

  let foundCard = null;

  // If we can determine type from ID, search directly
  if (typePart && typeMap[typePart]) {
    const section = typeMap[typePart];
    const sectionPath = buildSectionPath(projectId, section);
    const snapshot = await db.ref(sectionPath).once('value');
    const cardsData = snapshot.val();

    if (cardsData) {
      for (const [firebaseId, card] of Object.entries(cardsData)) {
        if (card.cardId === cardId) {
          foundCard = { firebaseId, ...card };
          break;
        }
      }
    }
  }

  // If not found, search all sections
  if (!foundCard) {
    for (const section of Object.keys(SECTION_MAP)) {
      const sectionPath = buildSectionPath(projectId, section);
      const snapshot = await db.ref(sectionPath).once('value');
      const cardsData = snapshot.val();

      if (cardsData) {
        for (const [firebaseId, card] of Object.entries(cardsData)) {
          if (card.cardId === cardId) {
            foundCard = { firebaseId, ...card };
            break;
          }
        }
      }
      if (foundCard) break;
    }
  }

  if (!foundCard) {
    return { content: [{ type: 'text', text: `Card "${cardId}" not found in project "${projectId}".` }] };
  }

  // Fetch development instructions for tasks
  let developmentInstructions = [];
  if (foundCard.cardType === 'Task' || typePart === 'TSK') {
    try {
      const instructionsSnapshot = await db.ref('global/instructions').once('value');
      const instructionsData = instructionsSnapshot.val();

      if (instructionsData) {
        developmentInstructions = Object.entries(instructionsData)
          .filter(([, instruction]) => {
            // Only include development category and non-archived
            const isDevelopment = instruction.category === 'development';
            const isActive = instruction.status !== 'archived';
            return isDevelopment && isActive;
          })
          .map(([, instruction]) => ({
            name: instruction.name,
            content: instruction.content
          }));
      }
    } catch (error) {
      // Silently fail - don't block card retrieval if instructions fail
    }
  }

  // Calculate available transitions for tasks
  let availableTransitions = null;
  if (foundCard.cardType === 'Task' || typePart === 'TSK') {
    availableTransitions = calculateAvailableTransitions(foundCard);
  }

  const response = {
    card: foundCard,
    ...(developmentInstructions.length > 0 && { developmentInstructions }),
    ...(availableTransitions && { availableTransitions })
  };

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}

/**
 * Resolve validator for a task based on priority rules:
 * 1. If validator explicitly provided, use it
 * 2. If developer exists as stakeholder in the project, use them
 * 3. If "Mánu Fosela" exists as stakeholder in the project, use them
 * 4. Error with list of available stakeholders
 */
async function resolveValidator(db, projectId, validator, developer) {
  if (validator) return validator;

  // Get global stakeholders data
  const stakeholdersSnapshot = await db.ref('/data/stakeholders').once('value');
  const stakeholdersData = stakeholdersSnapshot.val() || {};

  // Get project stakeholder IDs
  const projectStkSnapshot = await db.ref(`/projects/${projectId}/stakeholders`).once('value');
  const projectStkIds = projectStkSnapshot.val() || [];

  // Build list of project stakeholders with full info
  const projectStakeholders = [];
  for (const [stkId, stkData] of Object.entries(stakeholdersData)) {
    if (!stkId.startsWith('stk_') || typeof stkData !== 'object') continue;
    if (stkData.active === false) continue;
    if (Array.isArray(projectStkIds) && projectStkIds.includes(stkId)) {
      projectStakeholders.push({ id: stkId, name: stkData.name || '', email: stkData.email || '' });
    }
  }

  // Rule 1: If developer provided, check if they exist as stakeholder (by email)
  if (developer) {
    const devSnapshot = await db.ref(`/data/developers/${developer}`).once('value');
    const devData = devSnapshot.val();
    if (devData && devData.email) {
      const matchingStk = projectStakeholders.find(s => s.email === devData.email);
      if (matchingStk) return matchingStk.id;
    }
  }

  // Rule 2: Look for Mánu Fosela as stakeholder
  const manu = projectStakeholders.find(s => s.name === 'Mánu Fosela');
  if (manu) return manu.id;

  // Rule 3: No auto-assignment possible - error with available stakeholders
  if (projectStakeholders.length > 0) {
    const stkList = projectStakeholders.map(s => `  - ${s.id}: "${s.name}" (${s.email})`).join('\n');
    throw new Error(
      'Could not auto-assign a validator for this task. ' +
      'Please provide a validator ID (stk_XXX).\n\n' +
      `Available stakeholders in "${projectId}":\n${stkList}`
    );
  }

  throw new Error(
    `No stakeholders found in project "${projectId}". ` +
    'Add stakeholders to the project before creating tasks, or provide a validator ID explicitly.'
  );
}

export async function createCard({ projectId, type, title, description, descriptionStructured, acceptanceCriteria, acceptanceCriteriaStructured, epic, implementationPlan, status, priority, developer, codeveloper, validator, sprint, devPoints, businessPoints, year }) {
  const db = getDatabase();
  const firestore = getFirestore();

  // Auto-assign BecarIA as developer and current user as codeveloper for AI-driven tasks
  const mcpUser = getMcpUser();
  if (mcpUser && developer === 'dev_016') {
    // AI is the developer, set codeveloper to requesting user if not explicitly provided
    if (!codeveloper && mcpUser.developerId && mcpUser.developerId !== 'dev_016') {
      codeveloper = mcpUser.developerId;
    }
  }

  // Validate entity IDs (developer, codeveloper, validator, stakeholder)
  validateEntityIds({ developer, codeveloper, validator });

  // Validate implementationPlan if provided (only for tasks)
  if (type === 'task' && implementationPlan) {
    const planValidation = validateImplementationPlan(implementationPlan);
    if (!planValidation.valid) {
      const errorMessages = planValidation.errors.map(e => e.message).join('; ');
      throw new Error(`Invalid implementationPlan: ${errorMessages}`);
    }
  }

  // Build initial data for validation
  const initialData = { status, priority };

  // Validate type-specific fields before creating
  if (type === 'bug') {
    await validateBugFields(initialData, false);
  } else if (type === 'task') {
    await validateTaskFields(initialData, false);

    // Tasks MUST use descriptionStructured format
    if (!descriptionStructured || descriptionStructured.length === 0) {
      throw new Error(
        'Tasks require descriptionStructured in user story format. ' +
        'Use: descriptionStructured: [{role: "usuario/desarrollador/...", goal: "lo que quiere", benefit: "para qué lo quiere"}]. ' +
        'Example: {role: "desarrollador", goal: "crear una función de login", benefit: "permitir autenticación de usuarios"}'
      );
    }

    // Validate each item has required fields
    for (let i = 0; i < descriptionStructured.length; i++) {
      const item = descriptionStructured[i];
      if (!item.role || !item.goal || !item.benefit) {
        throw new Error(
          `descriptionStructured[${i}] is incomplete. Each item must have: role, goal, benefit. ` +
          `Got: role="${item.role || ''}", goal="${item.goal || ''}", benefit="${item.benefit || ''}"`
        );
      }
    }

    // Tasks MUST have acceptance criteria
    const hasAcceptanceCriteria =
      (acceptanceCriteria && typeof acceptanceCriteria === 'string' && acceptanceCriteria.trim() !== '') ||
      (Array.isArray(acceptanceCriteriaStructured) && acceptanceCriteriaStructured.length > 0);

    if (!hasAcceptanceCriteria) {
      throw new Error(
        'Tasks require acceptance criteria. ' +
        'Use acceptanceCriteria (plain text) OR acceptanceCriteriaStructured (Gherkin format): ' +
        '[{given: "context", when: "action", then: "expected result"}]. ' +
        'Example: {given: "el usuario está logueado", when: "hace clic en logout", then: "se cierra la sesión"}'
      );
    }

    // Validate acceptanceCriteriaStructured format if provided
    if (Array.isArray(acceptanceCriteriaStructured)) {
      for (let i = 0; i < acceptanceCriteriaStructured.length; i++) {
        const scenario = acceptanceCriteriaStructured[i];
        const hasGherkin = scenario.given || scenario.when || scenario.then;
        const hasRaw = scenario.raw && scenario.raw.trim() !== '';

        if (!hasGherkin && !hasRaw) {
          throw new Error(
            `acceptanceCriteriaStructured[${i}] is empty. Each scenario must have either: ` +
            `given/when/then fields OR a raw text field.`
          );
        }
      }
    }

    // Fetch available epics for validation and suggestions
    const epicSectionPath = buildSectionPath(projectId, 'epic');
    const epicSnapshot = await db.ref(epicSectionPath).once('value');
    const epicsData = epicSnapshot.val();

    const availableEpics = [];
    if (epicsData) {
      for (const [, epicCard] of Object.entries(epicsData)) {
        availableEpics.push({
          cardId: epicCard.cardId,
          title: epicCard.title,
          status: epicCard.status || 'N/A'
        });
      }
    }

    // Tasks MUST have an epic
    if (!epic || (typeof epic === 'string' && epic.trim() === '')) {
      const epicList = availableEpics.length > 0
        ? availableEpics.map(e => `  - ${e.cardId}: "${e.title}" (${e.status})`).join('\n')
        : '  (no epics found in this project)';

      throw new Error(
        'Tasks require an epic. ' +
        'Choose one of the available epics or create a new one with create_card(type="epic") first.\n\n' +
        `Available epics in "${projectId}":\n${epicList}`
      );
    }

    // Verify that the epic exists in the project
    let epicExists = availableEpics.some(e => e.cardId === epic);

    if (!epicExists) {
      const epicList = availableEpics.length > 0
        ? availableEpics.map(e => `  - ${e.cardId}: "${e.title}" (${e.status})`).join('\n')
        : '  (no epics found in this project)';

      throw new Error(
        `Epic "${epic}" not found in project "${projectId}". ` +
        'Choose one of the available epics or create a new one with create_card(type="epic") first.\n\n' +
        `Available epics:\n${epicList}`
      );
    }

    // Tasks CANNOT have priority set directly - it's calculated from points
    if (priority !== undefined) {
      throw new Error(
        'Cannot set priority directly for tasks. ' +
        'Priority is calculated automatically from devPoints and businessPoints ' +
        'using Planning Game formula: (businessPoints/devPoints)*100. ' +
        'Set devPoints and businessPoints instead.'
      );
    }

    // Validate sprint exists if provided
    await validateSprintExists(projectId, sprint);

    // Auto-resolve validator for tasks
    validator = await resolveValidator(db, projectId, validator, developer);
  }

  // Get project abbreviation
  const abbrSnapshot = await db.ref(`/projects/${projectId}/abbreviation`).once('value');
  const projectAbbr = abbrSnapshot.val();
  if (!projectAbbr) {
    throw new Error(`Project "${projectId}" has no abbreviation configured.`);
  }

  // Generate card ID using Firestore counter
  const sectionKey = SECTION_MAP[type];
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

  // Build card data with type-specific defaults
  const sectionPath = buildSectionPath(projectId, type);
  const newCardRef = db.ref(sectionPath).push();

  // Apply type-specific defaults
  const dataWithDefaults = applyTypeDefaults(type, {
    status,
    priority
  });

  // Generate description from descriptionStructured if available
  let finalDescription = description || '';
  if (descriptionStructured && descriptionStructured.length > 0) {
    // Generate markdown description from structured format
    finalDescription = descriptionStructured.map(item =>
      `**Como** ${item.role}\n**Quiero** ${item.goal}\n**Para** ${item.benefit}`
    ).join('\n\n');

    // Append any additional description if provided
    if (description) {
      finalDescription += '\n\n' + description;
    }
  }

  const cardData = {
    cardId,
    cardType: CARD_TYPE_MAP[type],
    group: GROUP_MAP[type],
    projectId,
    title,
    description: finalDescription,
    status: dataWithDefaults.status,
    priority: dataWithDefaults.priority,
    year: year || new Date().getFullYear(),
    createdAt: new Date().toISOString(),
    createdBy: 'geniova-mcp',
    firebaseId: newCardRef.key
  };

  // Add descriptionStructured if provided
  if (descriptionStructured && descriptionStructured.length > 0) {
    cardData.descriptionStructured = descriptionStructured;
  }

  // Add acceptance criteria if provided
  if (acceptanceCriteria && typeof acceptanceCriteria === 'string' && acceptanceCriteria.trim() !== '') {
    cardData.acceptanceCriteria = acceptanceCriteria;
  }
  if (Array.isArray(acceptanceCriteriaStructured) && acceptanceCriteriaStructured.length > 0) {
    cardData.acceptanceCriteriaStructured = acceptanceCriteriaStructured;
  }

  // Add epic if provided
  if (epic) {
    cardData.epic = epic;
  }

  // Add implementationPlan if provided (for tasks)
  if (type === 'task' && implementationPlan) {
    // Set default planStatus if not provided
    cardData.implementationPlan = {
      ...implementationPlan,
      steps: implementationPlan.steps || [],
      planStatus: implementationPlan.planStatus || 'pending'
    };
  }

  // Add registerDate for bugs
  if (type === 'bug' && dataWithDefaults.registerDate) {
    cardData.registerDate = dataWithDefaults.registerDate;
  }

  if (developer) cardData.developer = developer;
  if (codeveloper) cardData.codeveloper = codeveloper;
  if (validator) cardData.validator = validator;
  if (sprint) cardData.sprint = sprint;

  // Add devPoints and businessPoints if provided
  if (devPoints !== undefined) cardData.devPoints = devPoints;
  if (businessPoints !== undefined) cardData.businessPoints = businessPoints;

  // For tasks: calculate priority automatically if both points are provided
  if (type === 'task' && devPoints && businessPoints) {
    // Get scoring system from project
    const scoringSnapshot = await db.ref(`/projects/${projectId}/scoringSystem`).once('value');
    const scoringSystem = scoringSnapshot.val() || '1-5';
    const calculatedPriority = calculatePriority(businessPoints, devPoints, scoringSystem);
    if (calculatedPriority !== null) {
      cardData.priority = calculatedPriority;
    }
  }

  await newCardRef.set(cardData);

  const response = {
    message: `Card created successfully`,
    cardId,
    firebaseId: newCardRef.key,
    projectId,
    type
  };

  // For tasks: include plan-related instructions for the AI
  if (type === 'task') {
    if (implementationPlan) {
      response.planAction = {
        action: 'SHOW_PLAN_FOR_VALIDATION',
        message: 'Present the implementation plan to the user for review. If the user approves, update the card setting implementationPlan.planStatus to "validated". Do NOT start implementation until the plan is validated.',
        plan: cardData.implementationPlan
      };
    } else {
      response.planAction = {
        action: 'CREATE_PLAN',
        message: 'This task was created without an implementation plan. Create a plan (with approach and steps) and present it to the user for validation before starting implementation. Use update_card to add the implementationPlan with planStatus "proposed", then show it to the user for approval.'
      };
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}

/**
 * Required fields before transitioning tasks OUT of "To Do" to any other status.
 * A task cannot leave "To Do" without ALL these fields populated.
 */
export const REQUIRED_FIELDS_TO_LEAVE_TODO = [
  'title',
  'developer',
  'validator',
  'epic',
  'sprint',
  'devPoints',
  'businessPoints',
  'acceptanceCriteria'  // Can also be acceptanceCriteriaStructured
];

/**
 * Required fields before transitioning tasks to "To Validate".
 * These are checked IN ADDITION to REQUIRED_FIELDS_TO_LEAVE_TODO.
 */
export const REQUIRED_FIELDS_FOR_TO_VALIDATE = [
  'startDate',          // When work started
  'commits'             // At least one commit required
];

/**
 * Status transition rules for tasks - used by get_transition_rules tool
 */
export const TASK_TRANSITION_RULES = {
  'To Do': {
    allowedTransitions: ['In Progress', 'Blocked'],
    requirements: {
      'In Progress': REQUIRED_FIELDS_TO_LEAVE_TODO,
      'Blocked': [...REQUIRED_FIELDS_TO_LEAVE_TODO, 'blockedByBusiness OR blockedByDevelopment', 'bbbWhy/bbbWho OR bbdWhy/bbdWho']
    }
  },
  'In Progress': {
    allowedTransitions: ['To Validate', 'Blocked', 'To Do'],
    requirements: {
      'To Validate': [...REQUIRED_FIELDS_TO_LEAVE_TODO, ...REQUIRED_FIELDS_FOR_TO_VALIDATE],
      'Blocked': ['blockedByBusiness OR blockedByDevelopment', 'bbbWhy/bbbWho OR bbdWhy/bbdWho'],
      'To Do': []
    }
  },
  'To Validate': {
    allowedTransitions: ['Reopened'],
    mcpRestrictions: ['Done&Validated'],
    note: 'MCP cannot set Done&Validated - only validators can'
  },
  'Blocked': {
    allowedTransitions: ['In Progress', 'To Do'],
    requirements: {}
  },
  'Reopened': {
    allowedTransitions: ['In Progress', 'To Validate'],
    requirements: {
      'To Validate': [...REQUIRED_FIELDS_TO_LEAVE_TODO, ...REQUIRED_FIELDS_FOR_TO_VALIDATE]
    }
  },
  'Done&Validated': {
    allowedTransitions: [],
    note: 'Final state - no transitions allowed'
  }
};

/**
 * Check if a field has a valid value (not empty, not null, not undefined)
 * @param {Object} data - Card data
 * @param {string} field - Field name to check
 * @returns {boolean} - True if field has a valid value
 */
export function hasValidValue(data, field) {
  // Special case: acceptanceCriteria can be in either field
  if (field === 'acceptanceCriteria') {
    const ac = data.acceptanceCriteria;
    const acs = data.acceptanceCriteriaStructured;

    // Check acceptanceCriteria string
    if (ac && typeof ac === 'string' && ac.trim() !== '') {
      return true;
    }

    // Check acceptanceCriteriaStructured array
    if (Array.isArray(acs) && acs.length > 0) {
      // Ensure at least one scenario has content
      return acs.some(scenario =>
        (scenario.given && scenario.given.trim()) ||
        (scenario.when && scenario.when.trim()) ||
        (scenario.then && scenario.then.trim()) ||
        (scenario.raw && scenario.raw.trim())
      );
    }

    return false;
  }

  // Special case: numeric fields (devPoints, businessPoints)
  if (field === 'devPoints' || field === 'businessPoints') {
    const value = data[field];
    return value !== null && value !== undefined && value !== '' && Number(value) > 0;
  }

  // Standard string/value check
  const value = data[field];
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/**
 * Collect validation issues without throwing errors
 * Returns structured validation results for validateOnly mode
 * @param {Object} currentCard - Current card data
 * @param {Object} updates - Proposed updates
 * @param {string} type - Card type
 * @returns {Object} Validation results with missingFields, errors, and warnings
 */
export function collectValidationIssues(currentCard, updates, type) {
  const result = {
    valid: true,
    missingFields: [],
    errors: [],
    warnings: [],
    requiredFields: {}
  };

  // Only detailed validation for tasks
  if (type !== 'task') {
    return result;
  }

  const newStatus = updates.status;
  if (!newStatus) {
    return result; // No status change
  }

  const currentStatus = currentCard.status;
  if (currentStatus === newStatus) {
    return result; // Same status, no validation needed
  }

  // MCP cannot set tasks to "Done&Validated"
  if (VALIDATOR_ONLY_STATUSES.includes(newStatus)) {
    result.valid = false;
    result.errors.push({
      code: 'VALIDATOR_ONLY_STATUS',
      message: `MCP cannot change task status to "${newStatus}". Only the assigned validator or co-validator can change the status.`,
      suggestion: 'Use "To Validate" instead. The validator will then set it to "Done&Validated" if approved, or "Reopened" if changes are needed.'
    });
    return result;
  }

  // CRITICAL: Transitioning OUT of "To Do" requires ALL mandatory fields
  // This applies to ANY status change from "To Do" (In Progress, To Validate, Blocked, etc.)
  const normalizedCurrentStatus = (currentStatus || '').toLowerCase().replace(/\s+/g, '');
  if (normalizedCurrentStatus === 'todo' && newStatus !== 'To Do') {
    const finalCard = { ...currentCard, ...updates };

    for (const field of REQUIRED_FIELDS_TO_LEAVE_TODO) {
      const fieldHasValue = hasValidValue(finalCard, field);

      result.requiredFields[field] = {
        required: true,
        currentValue: currentCard[field] || null,
        providedInUpdate: updates[field] !== undefined,
        finalValue: finalCard[field] || null,
        missing: !fieldHasValue
      };

      if (!fieldHasValue) {
        result.missingFields.push(field);
        result.valid = false;
      }
    }

    if (result.missingFields.length > 0) {
      // Make field names more user-friendly
      const friendlyNames = {
        'acceptanceCriteria': 'Acceptance Criteria',
        'devPoints': 'Dev Points',
        'businessPoints': 'Business Points',
        'epic': 'Epic',
        'sprint': 'Sprint',
        'developer': 'Developer',
        'validator': 'Validator',
        'title': 'Title'
      };

      const friendlyMissing = result.missingFields.map(f => friendlyNames[f] || f);

      result.errors.push({
        code: 'MISSING_REQUIRED_FIELDS',
        message: `Cannot change task from "To Do" to "${newStatus}": missing required fields: ${friendlyMissing.join(', ')}.`,
        suggestion: 'A task cannot leave "To Do" without ALL these fields: title, developer, validator, epic, sprint, devPoints, businessPoints, and acceptanceCriteria.'
      });
    }
  }

  // Validate "To Validate" status requires additional fields
  if (newStatus === 'To Validate') {
    const finalCard = { ...currentCard, ...updates };

    // Check startDate
    if (!hasValidValue(finalCard, 'startDate')) {
      result.valid = false;
      result.missingFields.push('startDate');
      result.requiredFields.startDate = {
        required: true,
        currentValue: currentCard.startDate || null,
        providedInUpdate: updates.startDate !== undefined,
        finalValue: finalCard.startDate || null,
        missing: true
      };
      result.errors.push({
        code: 'MISSING_START_DATE',
        message: 'Cannot change to "To Validate": startDate is required.',
        suggestion: 'Include startDate (when work started) in ISO format: startDate: "2024-01-15"'
      });
    }

    // Check commits
    const commits = finalCard.commits;
    const hasCommits = Array.isArray(commits) && commits.length > 0;

    if (!hasCommits) {
      result.valid = false;
      result.missingFields.push('commits');
      result.requiredFields.commits = {
        required: true,
        currentValue: currentCard.commits || null,
        providedInUpdate: updates.commits !== undefined,
        finalValue: finalCard.commits || null,
        missing: true
      };
      result.errors.push({
        code: 'MISSING_COMMITS',
        message: 'Cannot change to "To Validate": at least one commit is required.',
        suggestion: 'Include commits in the update with: commits: [{ hash: "abc123", message: "...", date: "2024-01-01T00:00:00Z", author: "dev@example.com" }]'
      });
    }

    // Verify all base required fields are still present
    const allRequiredForValidate = [...REQUIRED_FIELDS_TO_LEAVE_TODO];
    for (const field of allRequiredForValidate) {
      if (!hasValidValue(finalCard, field) && !result.missingFields.includes(field)) {
        result.valid = false;
        result.missingFields.push(field);
        result.errors.push({
          code: 'MISSING_REQUIRED_FIELD',
          message: `Cannot change to "To Validate": ${field} is required.`
        });
      }
    }
  }

  return result;
}

/**
 * Collect bug validation issues without throwing
 * @param {Object} data - Data to validate
 * @returns {Object} Validation results
 */
export async function collectBugValidationIssues(data) {
  const result = {
    valid: true,
    errors: []
  };

  const validBugStatuses = await getListTexts('bugStatus');
  const validBugPriorities = await getListTexts('bugPriority');

  if (data.status !== undefined && !validBugStatuses.includes(data.status)) {
    result.valid = false;
    result.errors.push({
      code: 'INVALID_STATUS',
      message: `Invalid bug status "${data.status}".`,
      validValues: validBugStatuses
    });
  }

  if (data.priority !== undefined && !validBugPriorities.includes(data.priority)) {
    result.valid = false;
    result.errors.push({
      code: 'INVALID_PRIORITY',
      message: `Invalid bug priority "${data.priority}".`,
      validValues: validBugPriorities
    });
  }

  return result;
}

/**
 * Collect task validation issues without throwing
 * @param {Object} data - Data to validate
 * @returns {Object} Validation results
 */
export async function collectTaskValidationIssues(data) {
  const result = {
    valid: true,
    errors: []
  };

  const validTaskStatuses = await getListTexts('taskStatus');

  if (data.status !== undefined && !validTaskStatuses.includes(data.status)) {
    result.valid = false;
    result.errors.push({
      code: 'INVALID_STATUS',
      message: `Invalid task status "${data.status}".`,
      validValues: validTaskStatuses
    });
  }

  if (data.priority !== undefined && !VALID_TASK_PRIORITIES.includes(data.priority)) {
    result.valid = false;
    result.errors.push({
      code: 'INVALID_PRIORITY',
      message: `Invalid task priority "${data.priority}".`,
      validValues: VALID_TASK_PRIORITIES
    });
  }

  return result;
}

/**
 * Status values that MCP cannot set (only validators can)
 */
export const VALIDATOR_ONLY_STATUSES = ['Done&Validated'];

/**
 * Required fields for "Blocked" status
 */
export const BLOCKED_REQUIRED_FIELDS = {
  blockedByBusiness: ['bbbWhy', 'bbbWho'],
  blockedByDevelopment: ['bbdWhy', 'bbdWho']
};

/**
 * Validate task status transitions
 * @param {Object} currentCard - Current card data
 * @param {Object} updates - Proposed updates
 * @param {string} type - Card type
 * @throws {Error} If validation fails
 */
export function validateStatusTransition(currentCard, updates, type) {
  // Only validate tasks
  if (type !== 'task') return;

  const newStatus = updates.status;
  if (!newStatus) return; // No status change

  const currentStatus = currentCard.status;
  if (currentStatus === newStatus) return; // Same status, no validation needed

  // MCP cannot set tasks to "Done&Validated" - only validators can
  if (VALIDATOR_ONLY_STATUSES.includes(newStatus)) {
    throw new Error(
      `MCP cannot change task status to "${newStatus}". ` +
      `Only the assigned validator or co-validator can change the status. ` +
      `Use "To Validate" instead. The validator will then set it to "Done&Validated" if approved, or "Reopened" if changes are needed.`
    );
  }

  // Merge current card with updates to check final state
  const finalCard = { ...currentCard, ...updates };

  // CRITICAL: Transitioning OUT of "To Do" requires ALL mandatory fields
  const normalizedCurrentStatus = (currentStatus || '').toLowerCase().replace(/\s+/g, '');
  if (normalizedCurrentStatus === 'todo' && newStatus !== 'To Do') {
    const missingFields = REQUIRED_FIELDS_TO_LEAVE_TODO.filter(field => !hasValidValue(finalCard, field));

    if (missingFields.length > 0) {
      // Make field names more user-friendly
      const friendlyNames = {
        'acceptanceCriteria': 'Acceptance Criteria',
        'devPoints': 'Dev Points',
        'businessPoints': 'Business Points',
        'epic': 'Epic',
        'sprint': 'Sprint',
        'developer': 'Developer',
        'validator': 'Validator',
        'title': 'Title'
      };

      const friendlyMissing = missingFields.map(f => friendlyNames[f] || f);

      throw new Error(
        `Cannot change task from "To Do" to "${newStatus}": missing required fields: ${friendlyMissing.join(', ')}. ` +
        `A task cannot leave "To Do" without ALL these fields populated.`
      );
    }
  }

  // Validate "Blocked" status requires reason fields
  if (newStatus === 'Blocked') {
    const blockedByBusiness = finalCard.blockedByBusiness;
    const blockedByDevelopment = finalCard.blockedByDevelopment;

    // At least one blocker type must be set
    if (!blockedByBusiness && !blockedByDevelopment) {
      throw new Error(
        'Cannot change to "Blocked": must specify blockedByBusiness=true or blockedByDevelopment=true (or both).'
      );
    }

    const missingBlockedFields = [];

    // If blocked by business, need bbbWhy and bbbWho
    if (blockedByBusiness) {
      if (!hasValidValue(finalCard, 'bbbWhy')) missingBlockedFields.push('bbbWhy (reason for business block)');
      if (!hasValidValue(finalCard, 'bbbWho')) missingBlockedFields.push('bbbWho (who is blocking)');
    }

    // If blocked by development, need bbdWhy and bbdWho
    if (blockedByDevelopment) {
      if (!hasValidValue(finalCard, 'bbdWhy')) missingBlockedFields.push('bbdWhy (reason for development block)');
      if (!hasValidValue(finalCard, 'bbdWho')) missingBlockedFields.push('bbdWho (who is blocking)');
    }

    if (missingBlockedFields.length > 0) {
      throw new Error(
        `Cannot change to "Blocked": missing required fields: ${missingBlockedFields.join(', ')}. ` +
        `When blocking a task, you must specify who is blocking and why.`
      );
    }
  }

  // Validate "To Validate" status requires additional fields
  if (newStatus === 'To Validate') {
    const missingForValidate = [];

    // Check startDate
    if (!hasValidValue(finalCard, 'startDate')) {
      missingForValidate.push('startDate (when work started, e.g., "2024-01-15")');
    }

    // Check commits
    const commits = finalCard.commits;
    const hasCommits = Array.isArray(commits) && commits.length > 0;
    if (!hasCommits) {
      missingForValidate.push('commits (at least one commit with hash, message, date, author)');
    }

    // Check all base required fields
    const friendlyNames = {
      'acceptanceCriteria': 'Acceptance Criteria',
      'devPoints': 'Dev Points',
      'businessPoints': 'Business Points',
      'epic': 'Epic',
      'sprint': 'Sprint',
      'developer': 'Developer',
      'validator': 'Validator',
      'title': 'Title'
    };

    for (const field of REQUIRED_FIELDS_TO_LEAVE_TODO) {
      if (!hasValidValue(finalCard, field)) {
        missingForValidate.push(friendlyNames[field] || field);
      }
    }

    if (missingForValidate.length > 0) {
      throw new Error(
        `Cannot change to "To Validate": missing required fields: ${missingForValidate.join(', ')}. ` +
        `All tasks must have complete information before being sent for validation.`
      );
    }
  }
}

export async function updateCard({ projectId, type, firebaseId, updates, validateOnly = false }) {
  const db = getDatabase();
  const sectionPath = buildSectionPath(projectId, type);
  const cardRef = db.ref(`${sectionPath}/${firebaseId}`);

  // Verify card exists
  const snapshot = await cardRef.once('value');
  if (!snapshot.exists()) {
    throw new Error(`Card with firebaseId "${firebaseId}" not found in ${type} section of project "${projectId}".`);
  }

  const currentCard = snapshot.val();

  // Prevent updating protected fields
  const protectedFields = ['cardId', 'firebaseId', 'cardType', 'group', 'projectId'];
  const protectedFieldsInUpdate = protectedFields.filter(field => field in updates);

  // In validateOnly mode, collect all issues; otherwise throw on first error
  if (validateOnly) {
    const validationResult = {
      valid: true,
      cardId: currentCard.cardId,
      currentStatus: currentCard.status,
      targetStatus: updates.status || currentCard.status,
      protectedFieldsViolation: protectedFieldsInUpdate,
      typeValidation: null,
      statusTransitionValidation: null,
      missingFields: [],
      currentCard: {
        cardId: currentCard.cardId,
        title: currentCard.title,
        status: currentCard.status,
        developer: currentCard.developer || null,
        validator: currentCard.validator || null,
        startDate: currentCard.startDate || null,
        endDate: currentCard.endDate || null
      }
    };

    // Check protected fields
    if (protectedFieldsInUpdate.length > 0) {
      validationResult.valid = false;
      validationResult.errors = validationResult.errors || [];
      validationResult.errors.push({
        code: 'PROTECTED_FIELD',
        message: `Cannot update protected fields: ${protectedFieldsInUpdate.join(', ')}`
      });
    }

    // Collect type-specific validation
    if (type === 'bug') {
      validationResult.typeValidation = await collectBugValidationIssues(updates);
      if (!validationResult.typeValidation.valid) {
        validationResult.valid = false;
      }
    } else if (type === 'task') {
      validationResult.typeValidation = await collectTaskValidationIssues(updates);
      if (!validationResult.typeValidation.valid) {
        validationResult.valid = false;
      }

      // Collect status transition validation
      validationResult.statusTransitionValidation = collectValidationIssues(currentCard, updates, type);
      if (!validationResult.statusTransitionValidation.valid) {
        validationResult.valid = false;
        validationResult.missingFields = validationResult.statusTransitionValidation.missingFields;
      }
    }

    // Validate commits field if provided (for tasks and bugs)
    if (updates.commits !== undefined && (type === 'task' || type === 'bug')) {
      validationResult.commitsValidation = validateCommitsField(updates.commits);
      if (!validationResult.commitsValidation.valid) {
        validationResult.valid = false;
      }
    }

    // Validate entity IDs (developer, validator, stakeholder)
    const entityIdIssues = collectEntityIdIssues(updates);
    if (entityIdIssues.length > 0) {
      validationResult.valid = false;
      validationResult.entityIdValidation = {
        valid: false,
        errors: entityIdIssues
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          validateOnly: true,
          ...validationResult
        }, null, 2)
      }]
    };
  }

  // Normal update mode - throw errors as before
  for (const field of protectedFieldsInUpdate) {
    throw new Error(`Cannot update protected field: "${field}"`);
  }

  // Auto-assign codeveloper when AI (BecarIA) is set as developer via update
  if (updates.developer === 'dev_016') {
    const mcpUser = getMcpUser();
    if (mcpUser && !updates.codeveloper && mcpUser.developerId && mcpUser.developerId !== 'dev_016') {
      updates.codeveloper = mcpUser.developerId;
    }
  }

  // Validate entity IDs (developer, codeveloper, validator, stakeholder)
  validateEntityIds(updates);

  // Validate type-specific fields
  if (type === 'bug') {
    await validateBugFields(updates, true);
    // Additional bug-specific validation for status transitions (closing)
    validateBugStatusTransition(currentCard, updates);
  } else if (type === 'task') {
    await validateTaskFields(updates, true);
    // Additional task-specific validation for status transitions
    validateStatusTransition(currentCard, updates, type);

    // Tasks CANNOT have priority set directly - it's calculated from points
    if (updates.priority !== undefined) {
      throw new Error(
        'Cannot set priority directly for tasks. ' +
        'Priority is calculated automatically from devPoints and businessPoints ' +
        'using Planning Game formula: (businessPoints/devPoints)*100. ' +
        'Set devPoints and businessPoints instead.'
      );
    }

    // Validate sprint exists if being updated
    if (updates.sprint !== undefined) {
      await validateSprintExists(projectId, updates.sprint);
    }
  }

  // Validate and process commits field if provided (for tasks and bugs)
  if (updates.commits !== undefined && (type === 'task' || type === 'bug')) {
    const commitsValidation = validateCommitsField(updates.commits);
    if (!commitsValidation.valid) {
      const errorMessages = commitsValidation.errors.map(e => e.message).join('; ');
      throw new Error(`Invalid commits field: ${errorMessages}`);
    }

    // Append new commits to existing ones (deduplicated by hash)
    updates.commits = appendCommitsToCard(currentCard, updates.commits);
  }

  // Validate and process implementationPlan if provided (for tasks)
  if (type === 'task' && updates.implementationPlan !== undefined) {
    // Migrate legacy string format to new structure
    const migratedPlan = migrateImplementationPlan(updates.implementationPlan);
    if (migratedPlan) {
      const planValidation = validateImplementationPlan(migratedPlan);
      if (!planValidation.valid) {
        const errorMessages = planValidation.errors.map(e => e.message).join('; ');
        throw new Error(`Invalid implementationPlan: ${errorMessages}`);
      }
      updates.implementationPlan = migratedPlan;
    }
  }

  // Handle planStatus transitions based on task status changes
  let warnings = [];
  if (type === 'task' && updates.status) {
    const newStatus = updates.status;
    const currentPlan = updates.implementationPlan || migrateImplementationPlan(currentCard.implementationPlan);
    const devPoints = updates.devPoints || currentCard.devPoints || 0;

    // When moving to "In Progress"
    if (newStatus === 'In Progress') {
      // Warn if devPoints >= 3 and no plan exists
      if (devPoints >= 3 && !currentPlan) {
        warnings.push({
          code: 'MISSING_IMPLEMENTATION_PLAN',
          message: `Task has ${devPoints} devPoints but no implementationPlan. Consider adding a plan with approach and steps before implementing.`
        });
      }

      // Warn if plan exists but hasn't been validated by the user
      if (currentPlan && currentPlan.planStatus === 'proposed') {
        warnings.push({
          code: 'PLAN_NOT_VALIDATED',
          message: 'The implementation plan has not been validated by the user. Present the plan to the user for approval and update planStatus to "validated" before starting implementation.'
        });
      }

      // Auto-update planStatus from "validated" to "in_progress"
      if (currentPlan && currentPlan.planStatus === 'validated') {
        if (!updates.implementationPlan) {
          updates.implementationPlan = { ...currentPlan };
        }
        updates.implementationPlan.planStatus = 'in_progress';
      }
    }

    // When moving to "To Validate"
    if (newStatus === 'To Validate') {
      // Auto-update planStatus to "completed"
      if (currentPlan && currentPlan.planStatus !== 'completed') {
        if (!updates.implementationPlan) {
          updates.implementationPlan = { ...currentPlan };
        }
        updates.implementationPlan.planStatus = 'completed';
      }

      // Reminder: consider updating app version
      warnings.push({
        code: 'VERSION_REMINDER',
        message: `Task "${currentCard.title}" is ready for validation. If this change affects the app version, consider updating it (npm version patch/minor/major).`
      });
    }
  }

  // Reminder for bugs moving to "Fixed"
  if (type === 'bug' && updates.status === 'Fixed') {
    warnings.push({
      code: 'VERSION_REMINDER',
      message: `Bug "${currentCard.title}" has been fixed. If this fix should be released, consider updating the app version (npm version patch).`
    });
  }

  // Auto-assign active sprint when moving task to "In Progress" (or any status out of "To Do")
  if (type === 'task' && updates.status) {
    const currentStatus = (currentCard.status || '').toLowerCase().replace(/\s+/g, '');
    const newStatus = updates.status;

    // If moving out of "To Do" and no sprint is assigned
    if (currentStatus === 'todo' && newStatus !== 'To Do') {
      const hasSprint = updates.sprint || currentCard.sprint;

      if (!hasSprint) {
        // Try to find and assign the active sprint
        const activeSprint = await getActiveSprint(projectId);
        if (activeSprint) {
          updates.sprint = activeSprint.cardId;
        }
        // If no active sprint found, the validation in validateStatusTransition
        // will catch it and throw an error about missing sprint field
      }
    }
  }

  // Auto-set startDate when moving task to "In Progress"
  if (type === 'task' && updates.status === 'In Progress') {
    const hasStartDate = updates.startDate || currentCard.startDate;
    if (!hasStartDate) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      updates.startDate = today;
    }
  }

  // Auto-calculate priority for tasks when devPoints or businessPoints are updated
  if (type === 'task') {
    const finalDevPoints = updates.devPoints !== undefined ? updates.devPoints : currentCard.devPoints;
    const finalBizPoints = updates.businessPoints !== undefined ? updates.businessPoints : currentCard.businessPoints;

    // If both points are available, calculate priority
    if (finalDevPoints && finalBizPoints) {
      const scoringSnapshot = await db.ref(`/projects/${projectId}/scoringSystem`).once('value');
      const scoringSystem = scoringSnapshot.val() || '1-5';
      const calculatedPriority = calculatePriority(finalBizPoints, finalDevPoints, scoringSystem);
      if (calculatedPriority !== null) {
        updates.priority = calculatedPriority;
      }
    }
  }

  // Add metadata
  updates.updatedAt = new Date().toISOString();
  updates.updatedBy = 'geniova-mcp';

  await cardRef.update(updates);

  // Return updated card
  const updatedSnapshot = await cardRef.once('value');

  const response = {
    message: 'Card updated successfully',
    card: updatedSnapshot.val()
  };

  // Include warnings if any
  if (warnings && warnings.length > 0) {
    response.warnings = warnings;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response, null, 2)
    }]
  };
}

/**
 * Valid relation types between cards
 */
export const VALID_RELATION_TYPES = ['related', 'blocks', 'blockedBy'];

/**
 * Schema for relating cards
 */
export const relateCardsSchema = z.object({
  projectId: z.string().describe('Project ID'),
  sourceCardId: z.string().describe('Source card ID (e.g., "PLN-TSK-0114")'),
  targetCardId: z.string().describe('Target card ID (e.g., "PLN-TSK-0115")'),
  relationType: z.enum(['related', 'blocks']).describe('Relation type: "related" (bidirectional link) or "blocks" (source blocks target)'),
  action: z.enum(['add', 'remove']).optional().describe('Action to perform (default: "add")')
});

/**
 * Helper to find a card by cardId and return its data with firebaseId and sectionPath
 */
async function findCardByCardId(db, projectId, cardId) {
  const typePart = cardId.split('-')[1];
  const typeMap = { TSK: 'task', BUG: 'bug', EPC: 'epic', PRP: 'proposal', SPR: 'sprint', _QA: 'qa' };

  // If we can determine type from ID, search directly
  if (typePart && typeMap[typePart]) {
    const section = typeMap[typePart];
    const sectionPath = buildSectionPath(projectId, section);
    const snapshot = await db.ref(sectionPath).once('value');
    const cardsData = snapshot.val();

    if (cardsData) {
      for (const [firebaseId, card] of Object.entries(cardsData)) {
        if (card.cardId === cardId) {
          return { firebaseId, card, sectionPath, section };
        }
      }
    }
  }

  // Search all sections
  for (const section of Object.keys(SECTION_MAP)) {
    const sectionPath = buildSectionPath(projectId, section);
    const snapshot = await db.ref(sectionPath).once('value');
    const cardsData = snapshot.val();

    if (cardsData) {
      for (const [firebaseId, card] of Object.entries(cardsData)) {
        if (card.cardId === cardId) {
          return { firebaseId, card, sectionPath, section };
        }
      }
    }
  }

  return null;
}

/**
 * Add or remove a relation from a card's relatedTasks array
 */
function updateRelatedTasks(currentRelations, targetCardId, targetProjectId, targetTitle, relationType, action) {
  const relations = Array.isArray(currentRelations) ? [...currentRelations] : [];

  if (action === 'remove') {
    // Remove relation matching cardId and type
    return relations.filter(r => !(r.id === targetCardId && r.type === relationType));
  }

  // Add: check if relation already exists
  const existingIndex = relations.findIndex(r => r.id === targetCardId && r.type === relationType);
  if (existingIndex >= 0) {
    // Already exists, update title if needed
    relations[existingIndex].title = targetTitle;
    return relations;
  }

  // Add new relation
  relations.push({
    id: targetCardId,
    projectId: targetProjectId,
    title: targetTitle,
    type: relationType
  });

  return relations;
}

/**
 * Relate two cards with a specified relation type
 * - "related": Creates bidirectional "related" links on both cards
 * - "blocks": Creates "blocks" on source and "blockedBy" on target
 */
export async function relateCards({ projectId, sourceCardId, targetCardId, relationType, action = 'add' }) {
  const db = getDatabase();

  // Validate cards are different
  if (sourceCardId === targetCardId) {
    throw new Error('Cannot relate a card to itself.');
  }

  // Find both cards
  const sourceResult = await findCardByCardId(db, projectId, sourceCardId);
  if (!sourceResult) {
    throw new Error(`Source card "${sourceCardId}" not found in project "${projectId}".`);
  }

  const targetResult = await findCardByCardId(db, projectId, targetCardId);
  if (!targetResult) {
    throw new Error(`Target card "${targetCardId}" not found in project "${projectId}".`);
  }

  const { firebaseId: sourceFirebaseId, card: sourceCard, sectionPath: sourceSectionPath } = sourceResult;
  const { firebaseId: targetFirebaseId, card: targetCard, sectionPath: targetSectionPath } = targetResult;

  // Determine relation types for source and target
  let sourceRelationType, targetRelationType;

  if (relationType === 'related') {
    sourceRelationType = 'related';
    targetRelationType = 'related';
  } else if (relationType === 'blocks') {
    sourceRelationType = 'blocks';
    targetRelationType = 'blockedBy';
  }

  // Update source card's relatedTasks
  const sourceUpdatedRelations = updateRelatedTasks(
    sourceCard.relatedTasks,
    targetCardId,
    projectId,
    targetCard.title,
    sourceRelationType,
    action
  );

  // Update target card's relatedTasks
  const targetUpdatedRelations = updateRelatedTasks(
    targetCard.relatedTasks,
    sourceCardId,
    projectId,
    sourceCard.title,
    targetRelationType,
    action
  );

  // Prepare updates
  const now = new Date().toISOString();
  const sourceUpdates = {
    relatedTasks: sourceUpdatedRelations,
    updatedAt: now,
    updatedBy: 'geniova-mcp'
  };
  const targetUpdates = {
    relatedTasks: targetUpdatedRelations,
    updatedAt: now,
    updatedBy: 'geniova-mcp'
  };

  // Apply updates
  await db.ref(`${sourceSectionPath}/${sourceFirebaseId}`).update(sourceUpdates);
  await db.ref(`${targetSectionPath}/${targetFirebaseId}`).update(targetUpdates);

  const actionVerb = action === 'add' ? 'created' : 'removed';
  const relationDescription = relationType === 'blocks'
    ? `${sourceCardId} blocks ${targetCardId}`
    : `${sourceCardId} ↔ ${targetCardId} (related)`;

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        message: `Relation ${actionVerb} successfully`,
        relation: relationDescription,
        sourceCard: {
          cardId: sourceCardId,
          relatedTasks: sourceUpdatedRelations
        },
        targetCard: {
          cardId: targetCardId,
          relatedTasks: targetUpdatedRelations
        }
      }, null, 2)
    }]
  };
}

/**
 * Check if a card has pending blockers (blockedBy relations with incomplete cards)
 * @param {Object} db - Database reference
 * @param {string} projectId - Project ID
 * @param {Object} card - Card data
 * @returns {Promise<{hasPendingBlockers: boolean, pendingBlockers: Array}>}
 */
export async function checkPendingBlockers(db, projectId, card) {
  const relatedTasks = card.relatedTasks || [];
  const blockedByRelations = relatedTasks.filter(r => r.type === 'blockedBy');

  if (blockedByRelations.length === 0) {
    return { hasPendingBlockers: false, pendingBlockers: [] };
  }

  const pendingBlockers = [];

  for (const blocker of blockedByRelations) {
    const blockerResult = await findCardByCardId(db, blocker.projectId || projectId, blocker.id);

    if (blockerResult) {
      const blockerStatus = blockerResult.card.status || '';
      const isComplete = blockerStatus === 'Done&Validated' || blockerStatus === 'Closed';

      if (!isComplete) {
        pendingBlockers.push({
          cardId: blocker.id,
          title: blocker.title || blockerResult.card.title,
          status: blockerStatus
        });
      }
    }
  }

  return {
    hasPendingBlockers: pendingBlockers.length > 0,
    pendingBlockers
  };
}

/**
 * Get transition rules for a card type
 * @param {Object} params - { type: 'task' | 'bug' }
 * @returns {Object} Transition rules
 */
export async function getTransitionRules({ type = 'task' }) {
  if (type === 'task') {
    const taskStatusPairs = await getListPairs('taskStatus');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          type: 'task',
          validStatuses: taskStatusPairs.map(p => p.text),
          validStatusPairs: taskStatusPairs,
          mcpRestrictedStatuses: VALIDATOR_ONLY_STATUSES,
          mcpRestrictedNote: 'MCP cannot set tasks to "Done&Validated". Only validators can approve tasks.',
          transitionRules: TASK_TRANSITION_RULES,
          requiredFieldsToLeaveToDo: REQUIRED_FIELDS_TO_LEAVE_TODO,
          requiredFieldsForToValidate: [...REQUIRED_FIELDS_TO_LEAVE_TODO, ...REQUIRED_FIELDS_FOR_TO_VALIDATE],
          fieldDescriptions: {
            title: 'Task title',
            developer: 'Developer ID (must start with dev_)',
            validator: 'Validator/Stakeholder ID (must start with stk_)',
            epic: 'Epic ID the task belongs to',
            sprint: 'Sprint ID or name',
            devPoints: 'Development points (numeric)',
            businessPoints: 'Business points (numeric)',
            acceptanceCriteria: 'Acceptance criteria (text or acceptanceCriteriaStructured array)',
            startDate: 'Date work started (YYYY-MM-DD format)',
            commits: 'Array of commits [{hash, message, date, author}]'
          },
          exampleValidUpdate: {
            status: 'To Validate',
            startDate: '2024-01-15',
            commits: [{ hash: 'abc1234', message: 'feat: implement feature', date: '2024-01-20T10:00:00Z', author: 'dev@example.com' }]
          }
        }, null, 2)
      }]
    };
  } else if (type === 'bug') {
    const bugStatusPairs = await getListPairs('bugStatus');
    const bugPriorityPairs = await getListPairs('bugPriority');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          type: 'bug',
          validStatuses: bugStatusPairs.map(p => p.text),
          validStatusPairs: bugStatusPairs,
          validPriorities: bugPriorityPairs.map(p => p.text),
          validPriorityPairs: bugPriorityPairs,
          note: 'Bugs follow a simpler workflow: Created → Assigned → Fixed → Verified → Closed'
        }, null, 2)
      }]
    };
  }

  throw new Error(`Unknown card type: ${type}`);
}

/**
 * Calculate available transitions for a specific card
 * @param {Object} card - Card data
 * @returns {Object} Available transitions with missing fields
 */
export function calculateAvailableTransitions(card) {
  const currentStatus = card.status || 'To Do';
  const transitions = {};

  // Get rules for current status
  const rules = TASK_TRANSITION_RULES[currentStatus];
  if (!rules) {
    return { currentStatus, note: 'Unknown status', transitions: {} };
  }

  // Check each possible transition
  const allPossibleStatuses = ['To Do', 'In Progress', 'To Validate', 'Blocked', 'Reopened', 'Done&Validated'];

  for (const targetStatus of allPossibleStatuses) {
    if (targetStatus === currentStatus) continue;

    const transition = {
      allowed: false,
      missing: [],
      reason: null
    };

    // Check if MCP can set this status
    if (VALIDATOR_ONLY_STATUSES.includes(targetStatus)) {
      transition.reason = 'Only validators can set this status';
      transitions[targetStatus] = transition;
      continue;
    }

    // Check if transition is allowed from current status
    if (!rules.allowedTransitions?.includes(targetStatus)) {
      transition.reason = `Cannot transition from "${currentStatus}" to "${targetStatus}"`;
      transitions[targetStatus] = transition;
      continue;
    }

    // Check required fields
    let requiredFields = [];

    if (targetStatus === 'In Progress' || targetStatus === 'To Validate' || targetStatus === 'Blocked') {
      // Leaving To Do requires base fields
      if (currentStatus === 'To Do') {
        requiredFields = [...REQUIRED_FIELDS_TO_LEAVE_TODO];
      }
    }

    if (targetStatus === 'To Validate') {
      requiredFields = [...REQUIRED_FIELDS_TO_LEAVE_TODO, ...REQUIRED_FIELDS_FOR_TO_VALIDATE];
    }

    if (targetStatus === 'Blocked') {
      const hasBlocker = card.blockedByBusiness || card.blockedByDevelopment;
      if (!hasBlocker) {
        transition.missing.push('blockedByBusiness OR blockedByDevelopment');
      }
      if (card.blockedByBusiness) {
        if (!card.bbbWhy) transition.missing.push('bbbWhy');
        if (!card.bbbWho) transition.missing.push('bbbWho');
      }
      if (card.blockedByDevelopment) {
        if (!card.bbdWhy) transition.missing.push('bbdWhy');
        if (!card.bbdWho) transition.missing.push('bbdWho');
      }
    }

    // Check each required field
    for (const field of requiredFields) {
      if (!hasValidValue(card, field)) {
        transition.missing.push(field);
      }
    }

    transition.allowed = transition.missing.length === 0;
    transitions[targetStatus] = transition;
  }

  return {
    currentStatus,
    transitions
  };
}

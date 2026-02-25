import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockData,
  setMockRtdbData,
  setMockFirestoreData,
  getMockRtdbData
} from './__mocks__/firebase.js';

// Mock the firebase module before importing cards and list-service
vi.mock('../src/firebase.js', async () => {
  const mock = await import('./__mocks__/firebase.js');
  return {
    getDatabase: mock.getDatabase,
    getFirestore: mock.getFirestore
  };
});

// Import after mocking
const {
  validateEntityId,
  validateEntityIds,
  validateBugFields,
  validateTaskFields,
  hasValidValue,
  getActiveSprint,
  createCard,
  updateCard,
  validateSprintExists,
  generatePriorityMap,
  calculatePriority,
  PRIORITY_MAP_1_5,
  PRIORITY_MAP_FIBONACCI,
  VALID_BUG_STATUSES,
  VALID_TASK_STATUSES,
  VALID_BUG_PRIORITIES,
  VALID_TASK_PRIORITIES,
  REQUIRED_FIELDS_TO_LEAVE_TODO,
  REQUIRED_FIELDS_TO_CLOSE_BUG,
  VALIDATOR_ONLY_STATUSES,
  validateBugStatusTransition
} = await import('../src/tools/cards.js');

const { invalidateCache } = await import('../src/services/list-service.js');

/**
 * Setup mock Firebase list data for ListService
 */
function setupMockLists() {
  setMockRtdbData('/data/bugpriorityList', {
    'APPLICATION BLOCKER': 1,
    'DEPARTMENT BLOCKER': 2,
    'INDIVIDUAL BLOCKER': 3,
    'USER EXPERIENCE ISSUE': 4,
    'WORKFLOW IMPROVEMENT': 5,
    'WORKAROUND AVAILABLE ISSUE': 6
  });
  setMockRtdbData('/data/statusList/bug-card', {
    'Created': 1,
    'Assigned': 2,
    'Fixed': 3,
    'Verified': 4,
    'Closed': 5
  });
  setMockRtdbData('/data/statusList/task-card', {
    'To Do': 1,
    'In Progress': 2,
    'To Validate': 3,
    'Done&Validated': 4,
    'Blocked': 5,
    'Reopened': 6
  });
}

describe('cards.js', () => {
  beforeEach(() => {
    resetMockData();
    invalidateCache();
    setupMockLists();
  });

  describe('validateEntityId', () => {
    it('should pass for valid developer ID', () => {
      expect(() => validateEntityId('developer', 'dev_123')).not.toThrow();
    });

    it('should pass for valid validator ID', () => {
      expect(() => validateEntityId('validator', 'stk_456')).not.toThrow();
    });

    it('should pass for valid stakeholder ID', () => {
      expect(() => validateEntityId('stakeholder', 'stk_789')).not.toThrow();
    });

    it('should throw for invalid developer ID prefix', () => {
      expect(() => validateEntityId('developer', 'usr_123')).toThrow(/must start with "dev_"/);
    });

    it('should throw for invalid stakeholder ID prefix', () => {
      expect(() => validateEntityId('stakeholder', 'dev_123')).toThrow(/must start with "stk_"/);
    });

    it('should pass for empty values (optional fields)', () => {
      expect(() => validateEntityId('developer', '')).not.toThrow();
      expect(() => validateEntityId('developer', null)).not.toThrow();
      expect(() => validateEntityId('developer', undefined)).not.toThrow();
    });
  });

  describe('validateBugFields', () => {
    it('should pass for valid bug status', async () => {
      await expect(validateBugFields({ status: 'Created' })).resolves.not.toThrow();
      await expect(validateBugFields({ status: 'Fixed' })).resolves.not.toThrow();
    });

    it('should throw for invalid bug status', async () => {
      await expect(validateBugFields({ status: 'In Progress' })).rejects.toThrow(/Invalid bug status/);
    });

    it('should pass for valid bug priority', async () => {
      await expect(validateBugFields({ priority: 'APPLICATION BLOCKER' })).resolves.not.toThrow();
    });

    it('should throw for invalid bug priority', async () => {
      await expect(validateBugFields({ priority: 'High' })).rejects.toThrow(/Invalid bug priority/);
    });
  });

  describe('validateTaskFields', () => {
    it('should pass for valid task status', async () => {
      for (const status of VALID_TASK_STATUSES) {
        await expect(validateTaskFields({ status })).resolves.not.toThrow();
      }
    });

    it('should throw for invalid task status', async () => {
      await expect(validateTaskFields({ status: 'Created' })).rejects.toThrow(/Invalid task status/);
    });

    it('should pass for valid task priority', async () => {
      for (const priority of VALID_TASK_PRIORITIES) {
        await expect(validateTaskFields({ priority })).resolves.not.toThrow();
      }
    });

    it('should throw for invalid task priority', async () => {
      await expect(validateTaskFields({ priority: 'APPLICATION BLOCKER' })).rejects.toThrow(/Invalid task priority/);
    });
  });

  describe('hasValidValue', () => {
    it('should return true for non-empty string', () => {
      expect(hasValidValue({ title: 'Test' }, 'title')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(hasValidValue({ title: '' }, 'title')).toBe(false);
      expect(hasValidValue({ title: '   ' }, 'title')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(hasValidValue({ title: null }, 'title')).toBe(false);
      expect(hasValidValue({ title: undefined }, 'title')).toBe(false);
      expect(hasValidValue({}, 'title')).toBe(false);
    });

    it('should check acceptanceCriteria string', () => {
      expect(hasValidValue({ acceptanceCriteria: 'Some criteria' }, 'acceptanceCriteria')).toBe(true);
      expect(hasValidValue({ acceptanceCriteria: '' }, 'acceptanceCriteria')).toBe(false);
    });

    it('should check acceptanceCriteriaStructured array', () => {
      expect(hasValidValue({
        acceptanceCriteriaStructured: [{ given: 'context', when: 'action', then: 'result' }]
      }, 'acceptanceCriteria')).toBe(true);

      expect(hasValidValue({
        acceptanceCriteriaStructured: []
      }, 'acceptanceCriteria')).toBe(false);
    });

    it('should validate numeric fields (devPoints, businessPoints)', () => {
      expect(hasValidValue({ devPoints: 5 }, 'devPoints')).toBe(true);
      expect(hasValidValue({ devPoints: 0 }, 'devPoints')).toBe(false);
      expect(hasValidValue({ devPoints: '' }, 'devPoints')).toBe(false);
      expect(hasValidValue({ businessPoints: 3 }, 'businessPoints')).toBe(true);
    });
  });

  describe('getActiveSprint', () => {
    it('should return sprint with "Active" status', async () => {
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', status: 'Planning', startDate: '2024-01-01', endDate: '2024-01-14' },
        'sprint2': { cardId: 'TP-SPR-0002', status: 'Active', startDate: '2024-01-15', endDate: '2024-01-28' }
      });

      const result = await getActiveSprint('TestProject');
      expect(result.cardId).toBe('TP-SPR-0002');
    });

    it('should return sprint with "In Progress" status', async () => {
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', status: 'In Progress', startDate: '2024-01-01', endDate: '2024-12-31' }
      });

      const result = await getActiveSprint('TestProject');
      expect(result.cardId).toBe('TP-SPR-0001');
    });

    it('should return sprint by date range if no active status', async () => {
      const today = new Date().toISOString().split('T')[0];
      const pastDate = '2020-01-01';
      const futureDate = '2030-12-31';

      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', status: 'Planning', startDate: pastDate, endDate: futureDate }
      });

      const result = await getActiveSprint('TestProject');
      expect(result.cardId).toBe('TP-SPR-0001');
    });

    it('should return null if no active sprint', async () => {
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', status: 'Completed', startDate: '2020-01-01', endDate: '2020-01-14' }
      });

      const result = await getActiveSprint('TestProject');
      expect(result).toBeNull();
    });

    it('should return null if no sprints exist', async () => {
      const result = await getActiveSprint('TestProject');
      expect(result).toBeNull();
    });
  });

  describe('createCard - Task validation', () => {
    beforeEach(() => {
      // Setup basic project data
      setMockRtdbData('/projects/TestProject/abbreviation', 'TP');
      setMockFirestoreData('projectCounters', 'TP-TSK', { lastId: 0 });
      setMockRtdbData('/cards/TestProject/EPICS_TestProject', {
        'epic1': { cardId: 'TP-EPC-0001', title: 'Test Epic' }
      });
      // Setup stakeholders and developers for validator auto-assignment
      setMockRtdbData('/data/stakeholders', {
        'stk_001': { name: 'Dev User', email: 'dev@test.com', active: true },
        'stk_002': { name: 'Mánu Fosela', email: 'mfosela@geniova.com', active: true },
        'stk_003': { name: 'Other Stk', email: 'other@test.com', active: true }
      });
      setMockRtdbData('/projects/TestProject/stakeholders', ['stk_001', 'stk_002', 'stk_003']);
      setMockRtdbData('/data/developers/dev_100', { name: 'Dev User', email: 'dev@test.com' });
      setMockRtdbData('/data/developers/dev_200', { name: 'No Stk Dev', email: 'nostk@test.com' });
      setMockRtdbData('/data/developers/dev_300', { name: 'Unknown Dev', email: 'unknown@test.com' });
    });

    it('should throw error when descriptionStructured is missing for task', async () => {
      await expect(createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task'
      })).rejects.toThrow(/Tasks require descriptionStructured/);
    });

    it('should throw error when descriptionStructured item is incomplete', async () => {
      await expect(createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user' }] // missing goal and benefit
      })).rejects.toThrow(/is incomplete/);
    });

    it('should throw error when acceptanceCriteria is missing for task', async () => {
      await expect(createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }]
      })).rejects.toThrow(/Tasks require acceptance criteria/);
    });

    it('should throw error when epic is missing for task', async () => {
      await expect(createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteria: 'Should work correctly'
      })).rejects.toThrow(/Tasks require an epic/);
    });

    it('should throw error when epic does not exist and list available epics', async () => {
      try {
        await createCard({
          projectId: 'TestProject',
          type: 'task',
          title: 'Test Task',
          descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
          acceptanceCriteria: 'Should work correctly',
          epic: 'TP-EPC-9999' // non-existent
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error.message).toMatch(/Epic "TP-EPC-9999" not found/);
        expect(error.message).toContain('TP-EPC-0001');
        expect(error.message).toContain('Test Epic');
      }
    });

    it('should list available epics when epic is missing', async () => {
      try {
        await createCard({
          projectId: 'TestProject',
          type: 'task',
          title: 'Test Task',
          descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
          acceptanceCriteria: 'Should work correctly'
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error.message).toMatch(/Tasks require an epic/);
        expect(error.message).toContain('TP-EPC-0001');
        expect(error.message).toContain('Test Epic');
      }
    });

    it('should create task successfully with all required fields', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteria: 'Should work correctly',
        epic: 'TP-EPC-0001'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Card created successfully');
      expect(response.cardId).toMatch(/^TP-TSK-\d{4}$/);
    });

    it('should save epic and acceptanceCriteria fields in the created task', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task with Epic',
        descriptionStructured: [{ role: 'developer', goal: 'test field saving', benefit: 'verify bug fix' }],
        acceptanceCriteria: 'All fields should be saved correctly',
        epic: 'TP-EPC-0001',
        developer: 'dev_123'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Card created successfully');

      // Verify the card was saved with the correct fields
      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      expect(savedCards).toBeTruthy();

      // Find the created card
      const cardEntries = Object.entries(savedCards);
      expect(cardEntries.length).toBeGreaterThan(0);

      const [, savedCard] = cardEntries[0];
      expect(savedCard.epic).toBe('TP-EPC-0001');
      expect(savedCard.acceptanceCriteria).toBe('All fields should be saved correctly');
      expect(savedCard.developer).toBe('dev_123');
      expect(savedCard.descriptionStructured).toEqual([{ role: 'developer', goal: 'test field saving', benefit: 'verify bug fix' }]);
    });

    it('should accept acceptanceCriteriaStructured instead of plain text', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteriaStructured: [{ given: 'context', when: 'action', then: 'result' }],
        epic: 'TP-EPC-0001'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Card created successfully');
    });

    it('should save acceptanceCriteriaStructured in the created task', async () => {
      const acceptanceCriteriaStructured = [
        { given: 'user is logged in', when: 'clicks logout', then: 'session ends' },
        { given: 'user is on home', when: 'clicks profile', then: 'profile page loads' }
      ];

      await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Structured AC',
        descriptionStructured: [{ role: 'user', goal: 'test AC', benefit: 'verify saving' }],
        acceptanceCriteriaStructured,
        epic: 'TP-EPC-0001'
      });

      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];

      expect(savedCard.acceptanceCriteriaStructured).toEqual(acceptanceCriteriaStructured);
      expect(savedCard.acceptanceCriteriaStructured).toHaveLength(2);
    });

    it('should save implementationPlan in the created task', async () => {
      const implementationPlan = {
        approach: 'Use TDD approach with unit tests first',
        steps: [
          { description: 'Create test file', status: 'pending' },
          { description: 'Implement feature', status: 'pending' }
        ],
        risks: 'May need refactoring',
        outOfScope: 'UI changes'
      };

      await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test with Plan',
        descriptionStructured: [{ role: 'dev', goal: 'implement feature', benefit: 'add value' }],
        acceptanceCriteria: 'Feature works as expected',
        epic: 'TP-EPC-0001',
        implementationPlan
      });

      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];

      expect(savedCard.implementationPlan).toBeDefined();
      expect(savedCard.implementationPlan.approach).toBe('Use TDD approach with unit tests first');
      expect(savedCard.implementationPlan.steps).toHaveLength(2);
      expect(savedCard.implementationPlan.risks).toBe('May need refactoring');
      expect(savedCard.implementationPlan.planStatus).toBe('pending'); // Auto-set default
    });

    it('should return planAction with SHOW_PLAN_FOR_VALIDATION when task has plan', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Task with Plan',
        descriptionStructured: [{ role: 'dev', goal: 'implement feature', benefit: 'add value' }],
        acceptanceCriteria: 'Feature works',
        epic: 'TP-EPC-0001',
        implementationPlan: {
          approach: 'Use TDD',
          steps: [{ description: 'Write tests' }]
        }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.planAction).toBeDefined();
      expect(response.planAction.action).toBe('SHOW_PLAN_FOR_VALIDATION');
      expect(response.planAction.plan).toBeDefined();
      expect(response.planAction.plan.approach).toBe('Use TDD');
    });

    it('should return planAction with CREATE_PLAN when task has no plan', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Task without Plan',
        descriptionStructured: [{ role: 'dev', goal: 'implement feature', benefit: 'add value' }],
        acceptanceCriteria: 'Feature works',
        epic: 'TP-EPC-0001'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.planAction).toBeDefined();
      expect(response.planAction.action).toBe('CREATE_PLAN');
    });

    it('should not return planAction for non-task types', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'bug',
        title: 'Test Bug'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.planAction).toBeUndefined();
    });

    it('should auto-assign developer as validator when they exist as stakeholder', async () => {
      await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Task auto validator',
        descriptionStructured: [{ role: 'dev', goal: 'test', benefit: 'test' }],
        acceptanceCriteria: 'Works',
        epic: 'TP-EPC-0001',
        developer: 'dev_100' // email: dev@test.com -> matches stk_001
      });

      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];
      expect(savedCard.validator).toBe('stk_001');
    });

    it('should auto-assign Mánu Fosela as validator when developer is not a stakeholder', async () => {
      await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Task fallback validator',
        descriptionStructured: [{ role: 'dev', goal: 'test', benefit: 'test' }],
        acceptanceCriteria: 'Works',
        epic: 'TP-EPC-0001',
        developer: 'dev_200' // email: nostk@test.com -> no stk match, falls back to Mánu
      });

      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];
      expect(savedCard.validator).toBe('stk_002'); // Mánu Fosela
    });

    it('should error with stakeholder list when no auto-assignment possible', async () => {
      // Remove Mánu Fosela from project stakeholders
      setMockRtdbData('/projects/TestProject/stakeholders', ['stk_003']);

      try {
        await createCard({
          projectId: 'TestProject',
          type: 'task',
          title: 'Task no validator',
          descriptionStructured: [{ role: 'dev', goal: 'test', benefit: 'test' }],
          acceptanceCriteria: 'Works',
          epic: 'TP-EPC-0001',
          developer: 'dev_300' // no stk match, no Mánu in project
        });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error.message).toContain('Could not auto-assign a validator');
        expect(error.message).toContain('stk_003');
      }
    });

    it('should use explicit validator without auto-assignment', async () => {
      await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Task explicit validator',
        descriptionStructured: [{ role: 'dev', goal: 'test', benefit: 'test' }],
        acceptanceCriteria: 'Works',
        epic: 'TP-EPC-0001',
        developer: 'dev_100',
        validator: 'stk_003' // Explicit, different from dev's stk
      });

      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];
      expect(savedCard.validator).toBe('stk_003');
    });

    it('should save all optional fields correctly', async () => {
      // Setup sprint for this test
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', title: 'Sprint 1' }
      });

      await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Complete Task',
        description: 'Additional description text',
        descriptionStructured: [{ role: 'admin', goal: 'manage users', benefit: 'control access' }],
        acceptanceCriteria: 'All criteria met',
        epic: 'TP-EPC-0001',
        developer: 'dev_456',
        sprint: 'TP-SPR-0001', // Must be a valid sprint ID now
        devPoints: 3,
        businessPoints: 4,
        status: 'To Do',
        year: 2025
      });

      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];

      // Verify all fields are saved
      expect(savedCard.title).toBe('Complete Task');
      expect(savedCard.description).toContain('Additional description text');
      expect(savedCard.descriptionStructured).toEqual([{ role: 'admin', goal: 'manage users', benefit: 'control access' }]);
      expect(savedCard.acceptanceCriteria).toBe('All criteria met');
      expect(savedCard.epic).toBe('TP-EPC-0001');
      expect(savedCard.developer).toBe('dev_456');
      expect(savedCard.sprint).toBe('TP-SPR-0001');
      // Priority is now calculated automatically (4/3 ~= 133%)
      expect(savedCard.priority).toBeDefined();
      expect(typeof savedCard.priority).toBe('number');
      expect(savedCard.devPoints).toBe(3);
      expect(savedCard.businessPoints).toBe(4);
      expect(savedCard.status).toBe('To Do');
      expect(savedCard.year).toBe(2025);
    });
  });

  describe('updateCard - Status transitions', () => {
    beforeEach(() => {
      // Setup project and task data
      setMockRtdbData('/projects/TestProject/abbreviation', 'TP');
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do',
          description: 'Test description'
        }
      });
      // Setup active sprint
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', status: 'Active' }
      });
    });

    it('should throw error when trying to set Done&Validated status via MCP', async () => {
      await expect(updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'Done&Validated' }
      })).rejects.toThrow(/MCP cannot change task status to "Done&Validated"/);
    });

    it('should throw error when missing required fields to leave To Do', async () => {
      await expect(updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' }
      })).rejects.toThrow(/missing required fields/);
    });

    it('should auto-assign active sprint when moving to In Progress', async () => {
      // Setup complete task data - sprint will be auto-assigned
      // Note: sprint is required to leave To Do, so we include it in the update
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          sprint: 'TP-SPR-0001'  // Sprint is required to leave To Do
        }
      });

      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.status).toBe('In Progress');
    });

    it('should auto-set startDate when moving to In Progress', async () => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          sprint: 'TP-SPR-0001'
        }
      });

      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.startDate).toBe(new Date().toISOString().split('T')[0]);
    });

    it('should not overwrite existing startDate when moving to In Progress', async () => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'Blocked',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          sprint: 'TP-SPR-0001',
          startDate: '2025-12-01'
        }
      });

      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.startDate).toBe('2025-12-01');
    });

    it('should auto-transition planStatus from validated to in_progress when moving to In Progress', async () => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          sprint: 'TP-SPR-0001',
          implementationPlan: {
            approach: 'Use TDD',
            steps: [{ description: 'Write tests' }],
            planStatus: 'validated'
          }
        }
      });

      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.implementationPlan.planStatus).toBe('in_progress');
    });

    it('should warn when moving to In Progress with plan still in proposed status', async () => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          sprint: 'TP-SPR-0001',
          implementationPlan: {
            approach: 'Use TDD',
            steps: [{ description: 'Write tests' }],
            planStatus: 'proposed'
          }
        }
      });

      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.warnings).toBeDefined();
      const planWarning = response.warnings.find(w => w.code === 'PLAN_NOT_VALIDATED');
      expect(planWarning).toBeDefined();
      // planStatus should NOT auto-transition from proposed
      expect(response.card.implementationPlan.planStatus).toBe('proposed');
    });

    it('should require commits for To Validate status', async () => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'In Progress',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          sprint: 'TP-SPR-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          startDate: '2024-01-01'  // Required for To Validate
        }
      });

      await expect(updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'To Validate' }
      })).rejects.toThrow(/commits/i);  // Error should mention commits
    });

    it('should allow To Validate with commits', async () => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'In Progress',
          developer: 'dev_123',
          validator: 'stk_456',
          epic: 'TP-EPC-0001',
          sprint: 'TP-SPR-0001',
          devPoints: 3,
          businessPoints: 5,
          acceptanceCriteria: 'Should work',
          startDate: '2024-01-01'  // Required for To Validate
        }
      });

      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: {
          status: 'To Validate',
          commits: [{ hash: 'abc123', message: 'Fix bug', date: '2024-01-01', author: 'dev@test.com' }]
        }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.status).toBe('To Validate');
    });
  });

  describe('updateCard - validateOnly mode', () => {
    beforeEach(() => {
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do'
        }
      });
    });

    it('should return validation errors without applying changes', async () => {
      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { status: 'In Progress' },
        validateOnly: true
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.validateOnly).toBe(true);
      expect(response.valid).toBe(false);
      expect(response.missingFields.length).toBeGreaterThan(0);
    });

    it('should report protected field violations', async () => {
      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { cardId: 'HACKED' },
        validateOnly: true
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.protectedFieldsViolation).toContain('cardId');
    });
  });

  describe('Constants', () => {
    it('should have correct valid bug statuses', () => {
      expect(VALID_BUG_STATUSES).toContain('Created');
      expect(VALID_BUG_STATUSES).toContain('Closed');
    });

    it('should have correct valid task statuses', () => {
      expect(VALID_TASK_STATUSES).toContain('To Do');
      expect(VALID_TASK_STATUSES).toContain('In Progress');
      expect(VALID_TASK_STATUSES).toContain('Done&Validated');
    });

    it('should have correct required fields to leave To Do', () => {
      expect(REQUIRED_FIELDS_TO_LEAVE_TODO).toContain('developer');
      expect(REQUIRED_FIELDS_TO_LEAVE_TODO).toContain('acceptanceCriteria');
      expect(REQUIRED_FIELDS_TO_LEAVE_TODO).toContain('epic');
    });

    it('should have correct validator-only statuses', () => {
      expect(VALIDATOR_ONLY_STATUSES).not.toContain('Done');
      expect(VALIDATOR_ONLY_STATUSES).toContain('Done&Validated');
    });

    it('should have correct required fields to close bug', () => {
      expect(REQUIRED_FIELDS_TO_CLOSE_BUG).toContain('commits');
      expect(REQUIRED_FIELDS_TO_CLOSE_BUG).toContain('rootCause');
      expect(REQUIRED_FIELDS_TO_CLOSE_BUG).toContain('resolution');
    });
  });

  describe('validateBugStatusTransition', () => {
    it('should pass when not changing status', () => {
      const currentBug = { status: 'Fixed' };
      const updates = { priority: 'APPLICATION BLOCKER' };
      expect(() => validateBugStatusTransition(currentBug, updates)).not.toThrow();
    });

    it('should pass when status stays the same', () => {
      const currentBug = { status: 'Fixed' };
      const updates = { status: 'Fixed' };
      expect(() => validateBugStatusTransition(currentBug, updates)).not.toThrow();
    });

    it('should pass for non-Closed status transitions', () => {
      const currentBug = { status: 'Created' };
      const updates = { status: 'Assigned' };
      expect(() => validateBugStatusTransition(currentBug, updates)).not.toThrow();
    });

    it('should throw when closing bug without commits', () => {
      const currentBug = { status: 'Verified' };
      const updates = {
        status: 'Closed',
        rootCause: 'Memory leak',
        resolution: 'Fixed memory allocation'
      };
      expect(() => validateBugStatusTransition(currentBug, updates)).toThrow(/commits/);
    });

    it('should throw when closing bug without rootCause', () => {
      const currentBug = { status: 'Verified' };
      const updates = {
        status: 'Closed',
        commits: [{ hash: 'abc123', message: 'Fix', date: '2024-01-01', author: 'dev@test.com' }],
        resolution: 'Fixed memory allocation'
      };
      expect(() => validateBugStatusTransition(currentBug, updates)).toThrow(/rootCause/);
    });

    it('should throw when closing bug without resolution', () => {
      const currentBug = { status: 'Verified' };
      const updates = {
        status: 'Closed',
        commits: [{ hash: 'abc123', message: 'Fix', date: '2024-01-01', author: 'dev@test.com' }],
        rootCause: 'Memory leak'
      };
      expect(() => validateBugStatusTransition(currentBug, updates)).toThrow(/resolution/);
    });

    it('should pass when closing bug with all required fields', () => {
      const currentBug = { status: 'Verified' };
      const updates = {
        status: 'Closed',
        commits: [{ hash: 'abc123', message: 'Fix memory leak', date: '2024-01-01', author: 'dev@test.com' }],
        rootCause: 'Memory was not being freed after use',
        resolution: 'Added proper cleanup in destructor'
      };
      expect(() => validateBugStatusTransition(currentBug, updates)).not.toThrow();
    });

    it('should use existing values from currentBug when closing', () => {
      const currentBug = {
        status: 'Verified',
        commits: [{ hash: 'abc123', message: 'Fix', date: '2024-01-01', author: 'dev@test.com' }],
        rootCause: 'Memory leak'
      };
      const updates = {
        status: 'Closed',
        resolution: 'Fixed it'
      };
      expect(() => validateBugStatusTransition(currentBug, updates)).not.toThrow();
    });
  });

  describe('updateCard - Bug closing', () => {
    beforeEach(() => {
      setMockRtdbData('/cards/TestProject/BUGS_TestProject', {
        'bug1': {
          cardId: 'TP-BUG-0001',
          title: 'Test Bug',
          status: 'Verified'
        }
      });
    });

    it('should throw error when closing bug without required fields', async () => {
      await expect(updateCard({
        projectId: 'TestProject',
        type: 'bug',
        firebaseId: 'bug1',
        updates: { status: 'Closed' }
      })).rejects.toThrow(/Cannot close bug/);
    });

    it('should allow closing bug with all required fields', async () => {
      const result = await updateCard({
        projectId: 'TestProject',
        type: 'bug',
        firebaseId: 'bug1',
        updates: {
          status: 'Closed',
          commits: [{ hash: 'abc123', message: 'Fix bug', date: '2024-01-01', author: 'dev@test.com' }],
          rootCause: 'Null pointer exception due to uninitialized variable',
          resolution: 'Initialize variable before use'
        }
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.status).toBe('Closed');
      expect(response.card.rootCause).toBe('Null pointer exception due to uninitialized variable');
      expect(response.card.resolution).toBe('Initialize variable before use');
    });
  });

  describe('Sprint validation', () => {
    beforeEach(() => {
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', title: 'Sprint 1' },
        'sprint2': { cardId: 'TP-SPR-0002', title: 'Sprint 2' }
      });
    });

    it('should pass for valid sprint ID', async () => {
      await expect(validateSprintExists('TestProject', 'TP-SPR-0001')).resolves.not.toThrow();
    });

    it('should pass when sprint is undefined', async () => {
      await expect(validateSprintExists('TestProject', undefined)).resolves.not.toThrow();
    });

    it('should throw for non-existent sprint', async () => {
      await expect(validateSprintExists('TestProject', 'TP-SPR-9999'))
        .rejects.toThrow(/Sprint "TP-SPR-9999" not found/);
    });

    it('should throw for text sprint instead of ID', async () => {
      await expect(validateSprintExists('TestProject', 'Sprint 1'))
        .rejects.toThrow(/Sprint "Sprint 1" not found/);
    });

    it('should include available sprints in error message', async () => {
      await expect(validateSprintExists('TestProject', 'Invalid'))
        .rejects.toThrow(/Available sprints: TP-SPR-0001 \(Sprint 1\), TP-SPR-0002 \(Sprint 2\)/);
    });

    it('should throw when project has no sprints', async () => {
      resetMockData();
      await expect(validateSprintExists('EmptyProject', 'TP-SPR-0001'))
        .rejects.toThrow(/No sprints found in project "EmptyProject"/);
    });
  });

  describe('Priority calculation', () => {
    it('should generate 25 combinations for 1-5 system', () => {
      expect(PRIORITY_MAP_1_5.length).toBe(25);
    });

    it('should generate 36 combinations for fibonacci system', () => {
      expect(PRIORITY_MAP_FIBONACCI.length).toBe(36);
    });

    it('should have priority 1 for highest ratio (5/1 = 500%)', () => {
      const entry = PRIORITY_MAP_1_5.find(e => e.biz === 5 && e.dev === 1);
      expect(entry.priority).toBe(1);
    });

    it('should have priority 25 for lowest ratio in 1-5 (1/5 = 20%)', () => {
      const entry = PRIORITY_MAP_1_5.find(e => e.biz === 1 && e.dev === 5);
      expect(entry.priority).toBe(25);
    });

    it('should calculate priority correctly for ratio >= 500', () => {
      const priority = calculatePriority(5, 1, '1-5');
      expect(priority).toBe(1);
    });

    it('should calculate priority correctly for ratio = 100', () => {
      // 3/3 = 100%, 5/5 = 100%, etc.
      const priority = calculatePriority(3, 3, '1-5');
      expect(priority).toBeGreaterThan(1);
      expect(priority).toBeLessThan(25);
    });

    it('should calculate priority correctly for lowest ratio', () => {
      const priority = calculatePriority(1, 5, '1-5');
      expect(priority).toBe(25);
    });

    it('should return null when businessPoints is missing', () => {
      expect(calculatePriority(null, 3)).toBeNull();
      expect(calculatePriority(undefined, 3)).toBeNull();
      expect(calculatePriority(0, 3)).toBeNull();
    });

    it('should return null when devPoints is missing', () => {
      expect(calculatePriority(3, null)).toBeNull();
      expect(calculatePriority(3, undefined)).toBeNull();
      expect(calculatePriority(3, 0)).toBeNull();
    });

    it('should use fibonacci system when specified', () => {
      const priority = calculatePriority(13, 1, 'fibonacci');
      expect(priority).toBe(1); // Highest in fibonacci
    });
  });

  describe('createCard - Priority and Sprint validation', () => {
    beforeEach(() => {
      setMockRtdbData('/projects/TestProject/abbreviation', 'TP');
      setMockRtdbData('/projects/TestProject/scoringSystem', '1-5');
      setMockFirestoreData('projectCounters', 'TP-TSK', { lastId: 0 });
      setMockRtdbData('/cards/TestProject/EPICS_TestProject', {
        'epic1': { cardId: 'TP-EPC-0001', title: 'Test Epic' }
      });
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', title: 'Sprint 1' }
      });
      // Stakeholders needed for validator auto-assignment
      setMockRtdbData('/data/stakeholders', {
        'stk_002': { name: 'Mánu Fosela', email: 'mfosela@geniova.com', active: true }
      });
      setMockRtdbData('/projects/TestProject/stakeholders', ['stk_002']);
    });

    it('should reject manual priority in createCard for tasks', async () => {
      await expect(createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteria: 'Should work',
        epic: 'TP-EPC-0001',
        priority: 'High'
      })).rejects.toThrow(/Cannot set priority directly for tasks/);
    });

    it('should reject non-existent sprint in createCard', async () => {
      await expect(createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteria: 'Should work',
        epic: 'TP-EPC-0001',
        sprint: 'Invalid-Sprint'
      })).rejects.toThrow(/Sprint "Invalid-Sprint" not found/);
    });

    it('should accept valid sprint ID in createCard', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteria: 'Should work',
        epic: 'TP-EPC-0001',
        sprint: 'TP-SPR-0001'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Card created successfully');
    });

    it('should calculate priority when devPoints and businessPoints provided', async () => {
      const result = await createCard({
        projectId: 'TestProject',
        type: 'task',
        title: 'Test Task with Points',
        descriptionStructured: [{ role: 'user', goal: 'do something', benefit: 'get value' }],
        acceptanceCriteria: 'Should work',
        epic: 'TP-EPC-0001',
        devPoints: 2,
        businessPoints: 5
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Card created successfully');

      // Check that priority was calculated
      const savedCards = getMockRtdbData('/cards/TestProject/TASKS_TestProject');
      const [, savedCard] = Object.entries(savedCards)[0];
      expect(savedCard.devPoints).toBe(2);
      expect(savedCard.businessPoints).toBe(5);
      // 5/2 = 250%, should be a low priority number (high priority)
      expect(savedCard.priority).toBeDefined();
      expect(typeof savedCard.priority).toBe('number');
    });

    it('should allow priority for bugs (not calculated)', async () => {
      setMockFirestoreData('projectCounters', 'TP-BUG', { lastId: 0 });

      const result = await createCard({
        projectId: 'TestProject',
        type: 'bug',
        title: 'Test Bug',
        description: 'A bug',
        priority: 'APPLICATION BLOCKER'
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.message).toBe('Card created successfully');
    });
  });

  describe('updateCard - Priority and Sprint validation', () => {
    beforeEach(() => {
      setMockRtdbData('/projects/TestProject/abbreviation', 'TP');
      setMockRtdbData('/projects/TestProject/scoringSystem', '1-5');
      setMockRtdbData('/cards/TestProject/TASKS_TestProject', {
        'task1': {
          cardId: 'TP-TSK-0001',
          title: 'Test Task',
          status: 'To Do',
          devPoints: 3,
          businessPoints: 3
        }
      });
      setMockRtdbData('/cards/TestProject/SPRINTS_TestProject', {
        'sprint1': { cardId: 'TP-SPR-0001', title: 'Sprint 1', status: 'Active' }
      });
    });

    it('should reject manual priority in updateCard for tasks', async () => {
      await expect(updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { priority: 'High' }
      })).rejects.toThrow(/Cannot set priority directly for tasks/);
    });

    it('should reject non-existent sprint in updateCard', async () => {
      await expect(updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { sprint: 'Invalid-Sprint' }
      })).rejects.toThrow(/Sprint "Invalid-Sprint" not found/);
    });

    it('should calculate priority when devPoints updated', async () => {
      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { devPoints: 1 } // Now 3/1 = 300%, high priority
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.devPoints).toBe(1);
      expect(response.card.priority).toBeDefined();
      expect(typeof response.card.priority).toBe('number');
    });

    it('should calculate priority when businessPoints updated', async () => {
      const result = await updateCard({
        projectId: 'TestProject',
        type: 'task',
        firebaseId: 'task1',
        updates: { businessPoints: 5 } // Now 5/3 ~= 167%
      });

      const response = JSON.parse(result.content[0].text);
      expect(response.card.businessPoints).toBe(5);
      expect(response.card.priority).toBeDefined();
      expect(typeof response.card.priority).toBe('number');
    });
  });
});

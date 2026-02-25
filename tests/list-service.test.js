import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resetMockData,
  setMockRtdbData
} from './__mocks__/firebase.js';

// Mock Firebase before importing ListService
vi.mock('../src/firebase.js', async () => {
  const mock = await import('./__mocks__/firebase.js');
  return {
    getDatabase: mock.getDatabase,
    getFirestore: mock.getFirestore
  };
});

const {
  getListTexts,
  getListPairs,
  isValidValue,
  resolveValue,
  invalidateCache
} = await import('../src/services/list-service.js');

function setupMockLists() {
  setMockRtdbData('/data/bugpriorityList', {
    'Application Blocker': 1,
    'Department Blocker': 2,
    'Individual Blocker': 3,
    'User Experience Issue': 4,
    'Workaround Available Issue': 5,
    'Workflow Improvement': 6
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

describe('ListService', () => {
  beforeEach(() => {
    resetMockData();
    invalidateCache();
    setupMockLists();
  });

  describe('getListTexts', () => {
    it('should return sorted bug priority texts', async () => {
      const texts = await getListTexts('bugPriority');
      expect(texts).toEqual([
        'Application Blocker',
        'Department Blocker',
        'Individual Blocker',
        'User Experience Issue',
        'Workaround Available Issue',
        'Workflow Improvement'
      ]);
    });

    it('should return sorted bug status texts', async () => {
      const texts = await getListTexts('bugStatus');
      expect(texts).toEqual(['Created', 'Assigned', 'Fixed', 'Verified', 'Closed']);
    });

    it('should return sorted task status texts', async () => {
      const texts = await getListTexts('taskStatus');
      expect(texts).toEqual(['To Do', 'In Progress', 'To Validate', 'Done&Validated', 'Blocked', 'Reopened']);
    });

    it('should throw when Firebase data is empty', async () => {
      resetMockData();
      invalidateCache();
      await expect(getListTexts('bugPriority'))
        .rejects.toThrow(/Empty or null data at Firebase path/);
    });

    it('should throw for unknown list type', async () => {
      await expect(getListTexts('nonexistent'))
        .rejects.toThrow(/Unknown list type/);
    });
  });

  describe('getListPairs', () => {
    it('should return pairs with id, text, and order', async () => {
      const pairs = await getListPairs('bugPriority');
      expect(pairs.length).toBe(6);
      expect(pairs[0]).toEqual({
        id: 'Application Blocker',
        text: 'Application Blocker',
        order: 1
      });
      expect(pairs[5]).toEqual({
        id: 'Workflow Improvement',
        text: 'Workflow Improvement',
        order: 6
      });
    });

    it('should return pairs sorted by order', async () => {
      const pairs = await getListPairs('bugStatus');
      const orders = pairs.map(p => p.order);
      expect(orders).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('isValidValue', () => {
    it('should return true for valid bug priority', async () => {
      expect(await isValidValue('bugPriority', 'Application Blocker')).toBe(true);
      expect(await isValidValue('bugPriority', 'Workflow Improvement')).toBe(true);
    });

    it('should return false for invalid bug priority', async () => {
      expect(await isValidValue('bugPriority', 'High')).toBe(false);
      expect(await isValidValue('bugPriority', 'nonexistent')).toBe(false);
    });

    it('should return false for wrong casing (strict match)', async () => {
      expect(await isValidValue('bugPriority', 'APPLICATION BLOCKER')).toBe(false);
    });

    it('should return true for valid task status', async () => {
      expect(await isValidValue('taskStatus', 'To Do')).toBe(true);
      expect(await isValidValue('taskStatus', 'In Progress')).toBe(true);
    });

    it('should return false for invalid task status', async () => {
      expect(await isValidValue('taskStatus', 'Created')).toBe(false);
    });
  });

  describe('resolveValue', () => {
    it('should resolve exact match', async () => {
      const resolved = await resolveValue('bugPriority', 'Application Blocker');
      expect(resolved).toBe('Application Blocker');
    });

    it('should resolve UPPER CASE to canonical Title Case', async () => {
      const resolved = await resolveValue('bugPriority', 'APPLICATION BLOCKER');
      expect(resolved).toBe('Application Blocker');
    });

    it('should resolve lowercase to canonical', async () => {
      const resolved = await resolveValue('bugPriority', 'application blocker');
      expect(resolved).toBe('Application Blocker');
    });

    it('should resolve case-insensitive task status', async () => {
      const resolved = await resolveValue('taskStatus', 'to do');
      expect(resolved).toBe('To Do');
    });

    it('should throw for unresolvable value', async () => {
      await expect(resolveValue('bugPriority', 'NONEXISTENT'))
        .rejects.toThrow(/Invalid bugPriority value/);
    });

    it('should throw for completely invalid value', async () => {
      await expect(resolveValue('bugStatus', 'Unknown'))
        .rejects.toThrow(/Invalid bugStatus value/);
    });
  });

  describe('cache behavior', () => {
    it('should cache results between calls', async () => {
      const texts1 = await getListTexts('bugPriority');
      setMockRtdbData('/data/bugpriorityList', { 'New Priority': 1 });
      const texts2 = await getListTexts('bugPriority');
      expect(texts2).toEqual(texts1);
    });

    it('should return fresh data after cache invalidation', async () => {
      await getListTexts('bugPriority');
      setMockRtdbData('/data/bugpriorityList', { 'New Priority': 1 });
      invalidateCache('bugPriority');
      const texts = await getListTexts('bugPriority');
      expect(texts).toEqual(['New Priority']);
    });

    it('should invalidate all caches when no type specified', async () => {
      await getListTexts('bugPriority');
      await getListTexts('bugStatus');
      setMockRtdbData('/data/bugpriorityList', { 'Changed': 1 });
      setMockRtdbData('/data/statusList/bug-card', { 'NewStatus': 1 });
      invalidateCache();
      const priorities = await getListTexts('bugPriority');
      const statuses = await getListTexts('bugStatus');
      expect(priorities).toEqual(['Changed']);
      expect(statuses).toEqual(['NewStatus']);
    });
  });

  describe('error handling', () => {
    it('should throw when Firebase returns null data', async () => {
      resetMockData();
      invalidateCache();
      await expect(getListTexts('bugPriority'))
        .rejects.toThrow(/Empty or null data/);
    });

    it('should throw when Firebase returns empty object', async () => {
      setMockRtdbData('/data/bugpriorityList', {});
      invalidateCache('bugPriority');
      await expect(getListTexts('bugPriority'))
        .rejects.toThrow(/Empty or null data/);
    });

    it('should throw for unknown list type', async () => {
      await expect(getListTexts('invalidType'))
        .rejects.toThrow(/Unknown list type/);
    });
  });
});

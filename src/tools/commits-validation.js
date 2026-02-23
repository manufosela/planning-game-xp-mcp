/**
 * Commits field validation for tasks and bugs
 *
 * Structure of a commit:
 * {
 *   hash: string,      // Git commit hash (required)
 *   message: string,   // Commit message (required)
 *   date: string,      // ISO date string (required)
 *   author: string     // Author email (required)
 * }
 */

/**
 * Error codes for commits validation
 */
export const COMMITS_VALIDATION_ERROR_CODES = {
  NOT_AN_ARRAY: 'COMMITS_NOT_AN_ARRAY',
  MISSING_HASH: 'COMMIT_MISSING_HASH',
  MISSING_MESSAGE: 'COMMIT_MISSING_MESSAGE',
  MISSING_DATE: 'COMMIT_MISSING_DATE',
  MISSING_AUTHOR: 'COMMIT_MISSING_AUTHOR',
  INVALID_COMMIT_STRUCTURE: 'INVALID_COMMIT_STRUCTURE'
};

/**
 * Validate a single commit object
 * @param {Object} commit - Commit object to validate
 * @param {number} index - Index of commit in array (for error reporting)
 * @returns {Object} Validation result with valid flag and errors array
 */
function validateSingleCommit(commit, index) {
  const errors = [];

  if (!commit || typeof commit !== 'object') {
    errors.push({
      code: COMMITS_VALIDATION_ERROR_CODES.INVALID_COMMIT_STRUCTURE,
      message: `Commit at index ${index} is not a valid object`,
      index
    });
    return { valid: false, errors };
  }

  // Check required fields
  if (!commit.hash || (typeof commit.hash === 'string' && commit.hash.trim() === '')) {
    errors.push({
      code: COMMITS_VALIDATION_ERROR_CODES.MISSING_HASH,
      message: `Commit at index ${index} is missing required field: hash`,
      index
    });
  }

  if (!commit.message || (typeof commit.message === 'string' && commit.message.trim() === '')) {
    errors.push({
      code: COMMITS_VALIDATION_ERROR_CODES.MISSING_MESSAGE,
      message: `Commit at index ${index} is missing required field: message`,
      index
    });
  }

  if (!commit.date || (typeof commit.date === 'string' && commit.date.trim() === '')) {
    errors.push({
      code: COMMITS_VALIDATION_ERROR_CODES.MISSING_DATE,
      message: `Commit at index ${index} is missing required field: date`,
      index
    });
  }

  if (!commit.author || (typeof commit.author === 'string' && commit.author.trim() === '')) {
    errors.push({
      code: COMMITS_VALIDATION_ERROR_CODES.MISSING_AUTHOR,
      message: `Commit at index ${index} is missing required field: author`,
      index
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate the commits field
 * @param {any} commits - Value to validate
 * @returns {Object} Validation result with valid flag and errors array
 */
export function validateCommitsField(commits) {
  const result = {
    valid: true,
    errors: []
  };

  // Check if it's an array
  if (!Array.isArray(commits)) {
    result.valid = false;
    result.errors.push({
      code: COMMITS_VALIDATION_ERROR_CODES.NOT_AN_ARRAY,
      message: 'commits field must be an array'
    });
    return result;
  }

  // Empty array is valid
  if (commits.length === 0) {
    return result;
  }

  // Validate each commit
  for (let i = 0; i < commits.length; i++) {
    const commitResult = validateSingleCommit(commits[i], i);
    if (!commitResult.valid) {
      result.valid = false;
      result.errors.push(...commitResult.errors);
    }
  }

  return result;
}

/**
 * Append new commits to existing card commits
 * Does not duplicate commits with the same hash
 * @param {Object} currentCard - Current card data
 * @param {Array} newCommits - New commits to append
 * @returns {Array} Combined commits array
 */
export function appendCommitsToCard(currentCard, newCommits) {
  const existingCommits = currentCard.commits || [];

  // If no new commits, return existing
  if (!newCommits || !Array.isArray(newCommits) || newCommits.length === 0) {
    return existingCommits;
  }

  // Get existing hashes for deduplication
  const existingHashes = new Set(existingCommits.map(c => c.hash));

  // Append only new commits (by hash)
  const commitsToAdd = newCommits.filter(c => !existingHashes.has(c.hash));

  return [...existingCommits, ...commitsToAdd];
}

#!/usr/bin/env node

/**
 * Migration script: fix bug priority casing in existing cards.
 *
 * The PlanningGame webapp stores bug priorities in UPPER CASE
 * (e.g. "APPLICATION BLOCKER") as keys in /data/bugpriorityList.
 * Many legacy bugs were saved with Title Case (e.g. "Application Blocker")
 * causing the select to not find the value.
 *
 * Usage:
 *   node scripts/migrate-list-values.js --dry-run          # report only
 *   node scripts/migrate-list-values.js --apply             # apply fixes
 *   node scripts/migrate-list-values.js --dry-run --project Cinema4D  # single project
 *
 * Requires: MCP_INSTANCE_DIR or GOOGLE_APPLICATION_CREDENTIALS env var,
 *           or serviceAccountKey.json in the repo root.
 */

import admin from 'firebase-admin';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const apply = args.includes('--apply');
const projectFlag = args.indexOf('--project');
const singleProject = projectFlag !== -1 ? args[projectFlag + 1] : null;

if (!dryRun && !apply) {
  console.error('Usage: node scripts/migrate-list-values.js [--dry-run | --apply] [--project <id>]');
  console.error('  --dry-run   Report changes without applying them');
  console.error('  --apply     Apply changes to Firebase RTDB');
  console.error('  --project   Only process a single project');
  process.exit(1);
}

if (apply && !dryRun) {
  console.log('⚠️  APPLY mode — changes will be written to Firebase RTDB');
} else {
  console.log('ℹ️  DRY-RUN mode — no changes will be written');
}

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------
function resolveCredentialsPath() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  const instanceDir = process.env.MCP_INSTANCE_DIR;
  if (instanceDir) {
    const p = resolve(instanceDir, 'serviceAccountKey.json');
    if (existsSync(p)) return p;
  }
  return resolve(__dirname, '..', 'serviceAccountKey.json');
}

const credPath = resolveCredentialsPath();
if (!existsSync(credPath)) {
  console.error(`ERROR: credentials not found at ${credPath}`);
  process.exit(1);
}
const serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();

// ---------------------------------------------------------------------------
// Load canonical lists from Firebase
// ---------------------------------------------------------------------------
async function loadCanonicalLists() {
  const [bugPrioritySnap, bugStatusSnap, taskStatusSnap] = await Promise.all([
    db.ref('/data/bugpriorityList').once('value'),
    db.ref('/data/statusList/bug-card').once('value'),
    db.ref('/data/statusList/task-card').once('value')
  ]);

  return {
    bugPriority: bugPrioritySnap.val() || {},
    bugStatus: bugStatusSnap.val() || {},
    taskStatus: taskStatusSnap.val() || {}
  };
}

/**
 * Build a case-insensitive lookup map: lowercased text → canonical text
 */
function buildLookup(listObj) {
  const map = {};
  for (const key of Object.keys(listObj)) {
    map[key.toLowerCase()] = key;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main migration logic
// ---------------------------------------------------------------------------
async function migrate() {
  console.log('\nLoading canonical lists from Firebase...');
  const lists = await loadCanonicalLists();

  const bugPriorityLookup = buildLookup(lists.bugPriority);
  const bugStatusLookup = buildLookup(lists.bugStatus);
  const taskStatusLookup = buildLookup(lists.taskStatus);

  console.log(`  Bug priorities: ${Object.keys(lists.bugPriority).join(', ')}`);
  console.log(`  Bug statuses:   ${Object.keys(lists.bugStatus).join(', ')}`);
  console.log(`  Task statuses:  ${Object.keys(lists.taskStatus).join(', ')}`);

  // Load projects
  const projectsSnap = await db.ref('/projects').once('value');
  const projectsData = projectsSnap.val() || {};
  let projectIds = Object.keys(projectsData);

  if (singleProject) {
    if (!projectIds.includes(singleProject)) {
      console.error(`ERROR: Project "${singleProject}" not found. Available: ${projectIds.join(', ')}`);
      process.exit(1);
    }
    projectIds = [singleProject];
  }

  console.log(`\nProcessing ${projectIds.length} project(s)...\n`);

  const report = {
    timestamp: new Date().toISOString(),
    mode: dryRun ? 'dry-run' : 'apply',
    totalCards: 0,
    fixed: 0,
    alreadyCorrect: 0,
    errors: 0,
    details: []
  };

  for (const projectId of projectIds) {
    // Process bugs
    await processSection(projectId, 'BUGS', 'bug', {
      priority: { lookup: bugPriorityLookup, canonical: lists.bugPriority },
      status: { lookup: bugStatusLookup, canonical: lists.bugStatus }
    }, report);

    // Process tasks (only status, priority is numeric for tasks)
    await processSection(projectId, 'TASKS', 'task', {
      status: { lookup: taskStatusLookup, canonical: lists.taskStatus }
    }, report);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION REPORT');
  console.log('='.repeat(60));
  console.log(`Mode:              ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Total cards:       ${report.totalCards}`);
  console.log(`Already correct:   ${report.alreadyCorrect}`);
  console.log(`Fixed/to fix:      ${report.fixed}`);
  console.log(`Errors (unmapped): ${report.errors}`);
  console.log('='.repeat(60));

  // Write report to file
  const reportPath = resolve(__dirname, `migration-report-${Date.now()}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report saved to: ${reportPath}`);

  await admin.app().delete();
}

async function processSection(projectId, section, cardType, fieldChecks, report) {
  const sectionPath = `/cards/${projectId}/${section}_${projectId}`;
  const snap = await db.ref(sectionPath).once('value');
  const cards = snap.val();

  if (!cards) return;

  for (const [firebaseId, card] of Object.entries(cards)) {
    if (!card || card.deletedAt) continue;

    report.totalCards++;
    const cardId = card.cardId || firebaseId;
    const updates = {};
    let hasIssue = false;

    for (const [field, { lookup, canonical }] of Object.entries(fieldChecks)) {
      const currentValue = card[field];
      if (currentValue === undefined || currentValue === null || currentValue === '') {
        // Empty values — only report for priority field on bugs
        if (field === 'priority' && cardType === 'bug') {
          report.details.push({
            projectId, cardId, firebaseId, field,
            currentValue: currentValue ?? '(empty)',
            action: 'SKIP_EMPTY',
            message: 'Empty priority — needs manual assignment'
          });
          report.errors++;
          hasIssue = true;
        }
        continue;
      }

      // Skip numeric values (task priorities are calculated numbers)
      if (typeof currentValue === 'number') continue;

      // Check if already canonical
      if (currentValue in canonical) {
        continue; // Already correct
      }

      // Try case-insensitive match
      const resolved = lookup[currentValue.toLowerCase()];
      if (resolved) {
        updates[field] = resolved;
        report.details.push({
          projectId, cardId, firebaseId, field,
          currentValue,
          newValue: resolved,
          action: 'FIX_CASING'
        });
        hasIssue = true;
      } else {
        // Cannot resolve — unknown value
        report.details.push({
          projectId, cardId, firebaseId, field,
          currentValue,
          action: 'ERROR_UNMAPPED',
          message: `Cannot map "${currentValue}" to any canonical value`
        });
        report.errors++;
        hasIssue = true;
      }
    }

    if (Object.keys(updates).length > 0) {
      report.fixed++;
      if (apply && !dryRun) {
        try {
          await db.ref(`${sectionPath}/${firebaseId}`).update(updates);
        } catch (err) {
          report.details.push({
            projectId, cardId, firebaseId,
            action: 'WRITE_ERROR',
            message: err.message
          });
          report.errors++;
        }
      }
    } else if (!hasIssue) {
      report.alreadyCorrect++;
    }
  }
}

migrate().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

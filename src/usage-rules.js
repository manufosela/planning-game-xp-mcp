/**
 * Usage rules content for Planning Game MCP
 * Exposed as an MCP Resource so AI clients can read the rules when connecting
 */

export const USAGE_RULES_CONTENT = `
# Planning Game MCP - Usage Rules

## Mandatory Rules

### 1. Sprints
- The \`sprint\` field MUST be an existing sprint ID (e.g., "PRJ-SPR-0001")
- DO NOT use free text like "Sprint 1" or "February 2024"
- Use \`list_sprints\` to see available sprints
- Create a sprint with \`create_sprint\` if none exists

### 2. Task Priority
- DO NOT set \`priority\` directly for tasks
- Priority is calculated automatically: (businessPoints/devPoints)*100
- ALWAYS provide \`devPoints\` and \`businessPoints\` during Planning Game
- Scale: 1 (highest priority) to 25 (lowest) for 1-5 system, or 36 for fibonacci

### 3. Required Fields for Tasks
When creating a task:
- \`title\`: Descriptive title
- \`descriptionStructured\`: Format [{role, goal, benefit}]
- \`acceptanceCriteria\` or \`acceptanceCriteriaStructured\`
- \`epic\`: Existing epic ID (use list_cards type=epic)

When moving from "To Do":
- \`developer\`: ID with "dev_" prefix (e.g., "dev_001")
- \`validator\`: ID with "stk_" prefix (e.g., "stk_001")
- \`devPoints\`: Development points (1-5 or fibonacci)
- \`businessPoints\`: Business points (1-5 or fibonacci)
- \`sprint\`: Existing sprint ID

### 4. Entity IDs
- Developers: prefix "dev_" (e.g., "dev_001")
- Validators/Stakeholders: prefix "stk_" (e.g., "stk_001")
- Use \`list_developers\` and \`list_stakeholders\` to see available

### 5. Bugs
When closing a bug (status="Closed"):
- \`commits\`: Array of commits [{hash, message, date, author}]
- \`rootCause\`: Root cause of the bug
- \`resolution\`: How it was resolved

## Priority Calculation (Planning Game)

Formula: \`ratio = (businessPoints / devPoints) * 100\`

The mapping depends on the project's scoring system (\`scoringSystem\`):

### 1-5 System (25 combinations)
| businessPoints | devPoints | Ratio | Priority |
|---------------|-----------|-------|----------|
| 5 | 1 | 500 | 1 (highest) |
| 5 | 2 | 250 | ... |
| 1 | 5 | 20 | 25 (lowest) |

### Fibonacci System (36 combinations)
| businessPoints | devPoints | Ratio | Priority |
|---------------|-----------|-------|----------|
| 13 | 1 | 1300 | 1 (highest) |
| 8 | 1 | 800 | ... |
| 1 | 13 | ~8 | 36 (lowest) |

## Recommended Workflow

1. Query project: \`get_project\`
2. View available epics: \`list_cards type=epic\`
3. View available sprints: \`list_sprints\`
4. Create task with required fields
5. During Planning Game: update with developer, validator, points
6. When done: move to "To Validate" with commits

## Status Restrictions

- MCP CANNOT set tasks to "Done&Validated"
- Only validators can approve tasks
- Use "To Validate" to request validation
`;

# Planning Game MCP Server

MCP (Model Context Protocol) server for integrating Claude Code and OpenCode with Planning GameXP's Firebase Realtime Database.

## Features

- List and manage projects, tasks, bugs, epics, proposals, QA cards
- List and manage sprints
- List developers and stakeholders
- Full CRUD operations on cards

---

## TL;DR - Quick Start

```bash
# 1. Clone the repository
git clone git@github.com:Geniova-Technologies/planning-game-mcp.git
cd planning-game-mcp

# 2. Run the installer
./install.sh

# 3. Copy the Firebase credentials (get from Google Drive or Firebase Console)
cp /path/to/serviceAccountKey.json ~/mcp-servers/planning-game/

# 4. Edit your developer info
nano ~/mcp-servers/planning-game/.mcp-user.json

# 5. Restart Claude Code / OpenCode
```

---

## Prerequisites

Before installing, ensure you have:

- **Node.js** v18 or higher
- **npm** (comes with Node.js)
- **git**
- **Firebase service account key** (see [Getting Firebase Credentials](#getting-firebase-credentials))

---

## Installation

### Option 1: Automated Install (Recommended)

```bash
# Clone the repository
git clone git@github.com:Geniova-Technologies/planning-game-mcp.git
cd planning-game-mcp

# Run the installer
./install.sh
```

The installer will guide you through:
1. Choosing installation type (global or per-project)
2. Selecting your MCP client (Claude Code, OpenCode, or both)
3. Installing npm dependencies
4. Creating configuration files
5. Setting up your developer identity

### Option 2: Manual Global Installation

Install once in your home directory, available to all projects.

#### Step 1: Clone and install

```bash
# Create the mcp-servers directory
mkdir -p ~/mcp-servers

# Clone the repository
git clone git@github.com:Geniova-Technologies/planning-game-mcp.git ~/mcp-servers/planning-game

# Install dependencies
cd ~/mcp-servers/planning-game
npm install
```

#### Step 2: Add Firebase credentials

```bash
# Copy your serviceAccountKey.json to the installation directory
cp /path/to/serviceAccountKey.json ~/mcp-servers/planning-game/
```

#### Step 3: Configure Claude Code

Use the Claude CLI to add the MCP server globally:

```bash
claude mcp add planning-game \
  -e "GOOGLE_APPLICATION_CREDENTIALS=$HOME/mcp-servers/planning-game/serviceAccountKey.json" \
  -e "FIREBASE_DATABASE_URL=https://planning-gamexp-default-rtdb.europe-west1.firebasedatabase.app" \
  --scope user \
  -- node "$HOME/mcp-servers/planning-game/index.js"
```

Verify it was added:

```bash
claude mcp list
```

> **Note:** The `--scope user` flag makes this MCP available in all your projects.

#### Step 3b: Configure OpenCode (optional)

Create or edit `~/.config/opencode/config.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "planning-game": {
      "type": "local",
      "command": ["node", "/home/YOUR_USERNAME/mcp-servers/planning-game/index.js"],
      "environment": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/home/YOUR_USERNAME/mcp-servers/planning-game/serviceAccountKey.json",
        "FIREBASE_DATABASE_URL": "https://planning-gamexp-default-rtdb.europe-west1.firebasedatabase.app"
      }
    }
  }
}
```

> Replace `/home/YOUR_USERNAME` with your actual home path.

#### Step 4: Create your developer identity

```bash
cat > ~/mcp-servers/planning-game/.mcp-user.json << 'EOF'
{
  "developerId": "dev_XXX",
  "developerName": "Your Name",
  "developerEmail": "your@email.com"
}
EOF
```

> To find your `developerId`, run `list_developers` in Claude Code after setup.

#### Step 5: Restart Claude Code

Close and reopen Claude Code to detect the new MCP server.

### Option 3: Per-Project Installation (Git Submodule)

Use this when you need project-specific MCP configuration.

#### Step 1: Add as submodule

```bash
cd your-project/
git submodule add git@github.com:Geniova-Technologies/planning-game-mcp.git mcp-server
cd mcp-server && npm install && cd ..
```

#### Step 2: Copy Firebase credentials

```bash
# Copy to project root (NOT inside mcp-server/)
cp /path/to/serviceAccountKey.json ./
```

#### Step 3: Configure Claude Code

Create `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "planning-game": {
      "command": "node",
      "args": ["mcp-server/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "serviceAccountKey.json",
        "FIREBASE_DATABASE_URL": "https://planning-gamexp-default-rtdb.europe-west1.firebasedatabase.app"
      }
    }
  }
}
```

Or copy the example: `cp mcp-server/.mcp.json.example .mcp.json`

#### Step 4: Configure OpenCode (optional)

Create `opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "planning-game": {
      "type": "local",
      "command": ["node", "mcp-server/index.js"],
      "environment": {
        "GOOGLE_APPLICATION_CREDENTIALS": "serviceAccountKey.json",
        "FIREBASE_DATABASE_URL": "https://planning-gamexp-default-rtdb.europe-west1.firebasedatabase.app"
      }
    }
  }
}
```

Or copy the example: `cp mcp-server/opencode.json.example opencode.json`

#### Step 5: Create your developer identity

Create `.mcp-user.json` in your project root:

```json
{
  "developerId": "dev_XXX",
  "developerName": "Your Name",
  "developerEmail": "your@email.com"
}
```

#### Step 6: Update .gitignore

Add these entries to your `.gitignore`:

```gitignore
# MCP credentials (sensitive - do not commit!)
serviceAccountKey.json
.mcp-user.json
```

#### Step 7: Restart Claude Code / OpenCode

---

## Getting Firebase Credentials

You need the `serviceAccountKey.json` file to authenticate with Firebase.

### Option A: From Google Drive (Recommended for Geniova team)

```
Google Drive → APP-CONFIG → Planning-GameXP → MCP server PlanningGame → serviceAccountKey.json
```

### Option B: Generate new key

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select the **planning-gamexp** project
3. Go to **Project Settings** → **Service Accounts**
4. Click **Generate new private key**
5. Save the downloaded file as `serviceAccountKey.json`

---

## Updating

### Global installation

```bash
cd ~/mcp-servers/planning-game
git pull origin main
npm install
```

### Per-project (submodule)

```bash
cd mcp-server
git pull origin main
npm install
cd ..
git add mcp-server
git commit -m "chore: update mcp-server submodule"
```

---

## Available Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all projects with name, abbreviation, and developers |
| `get_project` | Get full details of a project |
| `create_project` | Create a new project |
| `update_project` | Update project fields |
| `list_cards` | List cards filtered by type, status, sprint, developer, year |
| `get_card` | Get full details of a card by cardId |
| `create_card` | Create a new card (task, bug, epic, proposal, qa) |
| `update_card` | Update fields of an existing card |
| `list_sprints` | List sprints of a project |
| `get_sprint` | Get full details of a sprint |
| `create_sprint` | Create a new sprint |
| `update_sprint` | Update sprint fields |
| `list_developers` | List all developers with name, email, and ID |
| `list_stakeholders` | List all stakeholders with name and email |

---

## Usage Examples

Once configured, you can use natural language commands:

```
"List the available projects"
"List tasks for project PLN"
"Get details of task PLN-TSK-0001"
"Create a task for project PLN: Allow users to export reports"
"Mark task PLN-TSK-0001 as In Progress"
"Show me the current sprint for project PLN"
"Who are the developers on this project?"
```

---

## Project Structure

### Global installation

```
~/mcp-servers/planning-game/
├── index.js                    # MCP server entry point
├── package.json
├── install.sh                  # Installation script
├── serviceAccountKey.json      # Firebase credentials (you provide this)
├── .mcp-user.json              # Your developer identity
└── src/
    ├── firebase.js
    ├── utils.js
    └── tools/
        ├── cards.js
        ├── developers.js
        ├── projects.js
        ├── sprints.js
        └── stakeholders.js
```

### Per-project installation

```
your-project/
├── .gitmodules                 # Submodule configuration (auto-generated)
├── .mcp.json                   # Claude Code config (commit this)
├── opencode.json               # OpenCode config (commit this)
├── .mcp-user.json              # Your identity (gitignored)
├── serviceAccountKey.json      # Firebase credentials (gitignored)
├── mcp-server/                 # This repo as submodule
│   ├── index.js
│   ├── package.json
│   └── src/
└── ... (your code)
```

---

## Troubleshooting

### MCP server not detected

1. Ensure you've restarted Claude Code / OpenCode after configuration
2. Verify paths in your configuration are correct:
   - Global: absolute paths (e.g., `/home/user/mcp-servers/...`)
   - Per-project: relative paths (e.g., `mcp-server/index.js`)
3. Test manually: `node ~/mcp-servers/planning-game/index.js`

### "Firebase not initialized" or "Cannot find serviceAccountKey.json"

1. Verify `serviceAccountKey.json` exists at the configured path
2. Check the JSON file is valid (no syntax errors)
3. Ensure the path in your configuration matches the actual file location

### "Permission denied" on Firebase

1. Verify the service account has access to the database
2. Check Firebase Database rules allow the service account

### "Cannot find module" errors

Run `npm install` in the mcp-server directory:

```bash
cd ~/mcp-servers/planning-game  # or ./mcp-server for per-project
npm install
```

### MCP server hangs / Claude Code freezes

1. Check Firebase connectivity
2. Verify `serviceAccountKey.json` is valid
3. Test: `node -e "require('./src/firebase.js')"`

---

## License

MIT

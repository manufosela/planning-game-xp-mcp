#!/bin/bash
# Planning Game MCP - Installation Script (Multi-instance)
# Supports: Claude Code, OpenCode, Codex, Cursor, Windsurf, Cline, Continue, Gemini CLI, Amazon Q, Roo Code
# Author: Geniova Technologies
#
# Architecture:
#   Engine:    ~/mcp-servers/planning-game/          (shared code, git repo)
#   Instances: ~/mcp-servers/planning-game-instances/{name}/  (config per Firebase)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Paths
ENGINE_DIR="$HOME/mcp-servers/planning-game"
INSTANCES_DIR="$HOME/mcp-servers/planning-game-instances"
REPO_URL="git@github.com:Geniova-Technologies/planning-game-mcp.git"

# Detect if running from cloned repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_header() {
  echo ""
  echo -e "${BLUE}========================================"
  echo -e "  Planning Game MCP - Installer"
  echo -e "  by Geniova Technologies"
  echo -e "  (Multi-instance architecture)"
  echo -e "========================================${NC}"
  echo ""
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}! $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_info() {
  echo -e "${BLUE}→ $1${NC}"
}

check_dependencies() {
  local missing=()

  if ! command -v node &> /dev/null; then
    missing+=("node")
  fi

  if ! command -v npm &> /dev/null; then
    missing+=("npm")
  fi

  if ! command -v git &> /dev/null; then
    missing+=("git")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    print_error "Missing required dependencies: ${missing[*]}"
    echo "Please install them before running this script."
    exit 1
  fi

  print_success "Dependencies check passed (node, npm, git)"
}

# Clone or update the engine (shared code)
ensure_engine() {
  echo ""

  # If running from the cloned repo itself, use that directory as engine
  if [ -f "$SCRIPT_DIR/index.js" ] && [ -f "$SCRIPT_DIR/package.json" ]; then
    ENGINE_DIR="$SCRIPT_DIR"
    print_info "Using engine from current directory: $ENGINE_DIR"

    # Install npm dependencies if needed
    if [ ! -d "$ENGINE_DIR/node_modules" ]; then
      print_info "Installing npm dependencies..."
      cd "$ENGINE_DIR"
      npm install
    fi

    print_success "Engine ready: $ENGINE_DIR"
    return 0
  fi

  # Otherwise, clone or update from remote
  if [ -d "$ENGINE_DIR" ] && [ -f "$ENGINE_DIR/index.js" ]; then
    print_info "Engine already exists: $ENGINE_DIR"
    read -p "Update engine to latest version? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      cd "$ENGINE_DIR"
      git pull origin main
      npm install
      print_success "Engine updated"
    fi
  else
    print_info "Cloning engine to: $ENGINE_DIR"
    mkdir -p "$(dirname "$ENGINE_DIR")"
    git clone "$REPO_URL" "$ENGINE_DIR"
    cd "$ENGINE_DIR"
    npm install
    print_success "Engine cloned and dependencies installed"
  fi
}

# Ask for instance name
ask_instance_name() {
  echo ""
  echo "Instance name (used to identify this Firebase connection):"
  echo ""
  echo "  Examples: pro, personal, staging, dev"
  echo "  Each instance has its own serviceAccountKey.json and mcp.user.json"
  echo ""
  read -p "Enter instance name [pro]: " INSTANCE_NAME
  INSTANCE_NAME="${INSTANCE_NAME:-pro}"

  # Sanitize: lowercase, alphanumeric and hyphens only
  INSTANCE_NAME=$(echo "$INSTANCE_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')

  INSTANCE_DIR="$INSTANCES_DIR/$INSTANCE_NAME"
  print_info "Instance: $INSTANCE_NAME ($INSTANCE_DIR)"
}

# Create instance directory with config files
create_instance() {
  echo ""

  if [ -d "$INSTANCE_DIR" ]; then
    print_warning "Instance directory already exists: $INSTANCE_DIR"

    if [ -f "$INSTANCE_DIR/serviceAccountKey.json" ]; then
      print_success "serviceAccountKey.json already present"
    fi

    read -p "Reconfigure this instance? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      return 0
    fi
  else
    mkdir -p "$INSTANCE_DIR"
    print_success "Created instance directory: $INSTANCE_DIR"
  fi

  # Copy serviceAccountKey.json
  if [ ! -f "$INSTANCE_DIR/serviceAccountKey.json" ]; then
    echo ""
    echo "  The instance needs a Firebase service account key."
    echo ""
    echo "  Get it from:"
    echo "  Google Drive > APP-CONFIG > Planning-GameXP > MCP server PlanningGame"
    echo "  OR"
    echo "  Firebase Console > Project Settings > Service Accounts > Generate new private key"
    echo ""
    read -p "Path to serviceAccountKey.json (or press Enter to skip): " sa_path

    if [ -n "$sa_path" ] && [ -f "$sa_path" ]; then
      cp "$sa_path" "$INSTANCE_DIR/serviceAccountKey.json"
      print_success "serviceAccountKey.json copied to instance"
    else
      if [ -n "$sa_path" ]; then
        print_error "File not found: $sa_path"
      fi
      print_warning "Remember to copy serviceAccountKey.json to: $INSTANCE_DIR/"
    fi
  fi

  # Ask for Firebase Database URL
  echo ""
  read -p "Firebase Database URL [https://planning-gamexp-default-rtdb.europe-west1.firebasedatabase.app]: " firebase_url
  FIREBASE_URL="${firebase_url:-https://planning-gamexp-default-rtdb.europe-west1.firebasedatabase.app}"
}

select_clients() {
  SELECTED_CLIENTS=()
  echo ""
  echo "Select MCP client(s) to configure:"
  echo ""
  echo "  CLI tools:"
  echo "    1) Claude Code"
  echo "    2) OpenCode"
  echo "    3) Codex (OpenAI)"
  echo "    4) Gemini CLI"
  echo "    5) Amazon Q CLI"
  echo ""
  echo "  IDE extensions:"
  echo "    6) Cursor"
  echo "    7) Windsurf"
  echo "    8) Cline (VS Code)"
  echo "    9) Continue (VS Code/JetBrains)"
  echo "   10) Roo Code (VS Code)"
  echo ""
  echo "    a) All    n) None (show config only)"
  echo ""
  read -p "Enter choices (comma-separated, e.g. 1,3,6): " choices

  if [ "$choices" = "n" ] || [ -z "$choices" ]; then
    return 0
  fi

  if [ "$choices" = "a" ]; then
    SELECTED_CLIENTS=(claude opencode codex gemini amazonq cursor windsurf cline continue roo)
    return 0
  fi

  IFS=',' read -ra selections <<< "$choices"
  for sel in "${selections[@]}"; do
    sel=$(echo "$sel" | tr -d ' ')
    case $sel in
      1) SELECTED_CLIENTS+=(claude) ;;
      2) SELECTED_CLIENTS+=(opencode) ;;
      3) SELECTED_CLIENTS+=(codex) ;;
      4) SELECTED_CLIENTS+=(gemini) ;;
      5) SELECTED_CLIENTS+=(amazonq) ;;
      6) SELECTED_CLIENTS+=(cursor) ;;
      7) SELECTED_CLIENTS+=(windsurf) ;;
      8) SELECTED_CLIENTS+=(cline) ;;
      9) SELECTED_CLIENTS+=(continue) ;;
      10) SELECTED_CLIENTS+=(roo) ;;
      *) print_warning "Unknown option: $sel" ;;
    esac
  done

  if [ ${#SELECTED_CLIENTS[@]} -gt 0 ]; then
    print_success "Selected: ${SELECTED_CLIENTS[*]}"
  fi
}

# Check if a client was selected
client_selected() {
  local target="$1"
  for c in "${SELECTED_CLIENTS[@]}"; do
    [ "$c" = "$target" ] && return 0
  done
  return 1
}

# Register instance in Claude Code with env vars
configure_claude_instance() {
  echo ""
  print_info "Configuring Claude Code..."

  local server_name="planning-game-${INSTANCE_NAME}"

  # Check if claude CLI is available
  if ! command -v claude &> /dev/null; then
    print_warning "Claude CLI not found. Manual config:"
    show_claude_manual_config
    return 0
  fi

  # Check if this instance already configured
  if claude mcp list 2>/dev/null | grep -q "$server_name"; then
    print_warning "$server_name already configured in Claude Code"
    read -p "Reconfigure? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      return 0
    fi
    claude mcp remove "$server_name" --scope user 2>/dev/null || true
  fi

  claude mcp add "$server_name" \
    -e "GOOGLE_APPLICATION_CREDENTIALS=$INSTANCE_DIR/serviceAccountKey.json" \
    -e "FIREBASE_DATABASE_URL=$FIREBASE_URL" \
    -e "MCP_INSTANCE_DIR=$INSTANCE_DIR" \
    --scope user \
    -- node "$ENGINE_DIR/index.js"

  if [ $? -eq 0 ]; then
    print_success "Claude Code configured: $server_name"
  else
    print_error "Failed to configure Claude Code"
    show_claude_manual_config
  fi
}

show_claude_manual_config() {
  local server_name="planning-game-${INSTANCE_NAME}"
  echo ""
  echo "  claude mcp add $server_name \\"
  echo "    -e \"GOOGLE_APPLICATION_CREDENTIALS=$INSTANCE_DIR/serviceAccountKey.json\" \\"
  echo "    -e \"FIREBASE_DATABASE_URL=$FIREBASE_URL\" \\"
  echo "    -e \"MCP_INSTANCE_DIR=$INSTANCE_DIR\" \\"
  echo "    --scope user \\"
  echo "    -- node \"$ENGINE_DIR/index.js\""
  echo ""
}

# Register instance in OpenCode
configure_opencode_instance() {
  echo ""
  print_info "Configuring OpenCode..."

  local server_name="planning-game-${INSTANCE_NAME}"
  local opencode_config="$HOME/.config/opencode/config.json"
  local opencode_dir="$(dirname "$opencode_config")"

  mkdir -p "$opencode_dir"

  if [ -f "$opencode_config" ]; then
    if grep -q "\"$server_name\"" "$opencode_config" 2>/dev/null; then
      print_warning "$server_name already configured in OpenCode"
      read -p "Reconfigure? (y/n) " -n 1 -r
      echo
      if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        return 0
      fi
    fi

    cp "$opencode_config" "$opencode_config.bak"
    print_info "Backup created: $opencode_config.bak"
  fi

  node -e "
    const fs = require('fs');
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync('$opencode_config', 'utf8'));
    } catch (e) {
      config = { '\$schema': 'https://opencode.ai/config.json' };
    }
    config.mcp = config.mcp || {};
    config.mcp['$server_name'] = {
      type: 'local',
      command: ['node', '$ENGINE_DIR/index.js'],
      environment: {
        GOOGLE_APPLICATION_CREDENTIALS: '$INSTANCE_DIR/serviceAccountKey.json',
        FIREBASE_DATABASE_URL: '$FIREBASE_URL',
        MCP_INSTANCE_DIR: '$INSTANCE_DIR'
      }
    };
    fs.writeFileSync('$opencode_config', JSON.stringify(config, null, 2));
  "

  print_success "OpenCode configured: $server_name"
}

show_instance_config() {
  local server_name="planning-game-${INSTANCE_NAME}"
  echo ""
  echo -e "${BLUE}=========================================================${NC}"
  echo ""
  echo "  MCP Server Configuration"
  echo ""
  echo "  Name:     $server_name"
  echo "  Command:  node $ENGINE_DIR/index.js"
  echo ""
  echo "  Environment:"
  echo "    GOOGLE_APPLICATION_CREDENTIALS=$INSTANCE_DIR/serviceAccountKey.json"
  echo "    FIREBASE_DATABASE_URL=$FIREBASE_URL"
  echo "    MCP_INSTANCE_DIR=$INSTANCE_DIR"
  echo ""
  echo -e "${BLUE}=========================================================${NC}"
}

# ─── Generic helpers ───────────────────────────────────────────────────────────

# Standard env vars for all clients
get_server_env_json() {
  cat <<ENVJSON
{
      "GOOGLE_APPLICATION_CREDENTIALS": "$INSTANCE_DIR/serviceAccountKey.json",
      "FIREBASE_DATABASE_URL": "$FIREBASE_URL",
      "MCP_INSTANCE_DIR": "$INSTANCE_DIR"
    }
ENVJSON
}

# Generic JSON MCP config writer
# Usage: write_json_mcp_config <config_file> <wrapper_key> <server_json>
write_json_mcp_config() {
  local config_file="$1"
  local wrapper_key="$2"
  local server_json="$3"
  local server_name="planning-game-${INSTANCE_NAME}"

  mkdir -p "$(dirname "$config_file")"

  node -e "
    const fs = require('fs');
    let config = {};
    try { config = JSON.parse(fs.readFileSync('$config_file', 'utf8')); } catch {}
    config['$wrapper_key'] = config['$wrapper_key'] || {};
    config['$wrapper_key']['$server_name'] = $server_json;
    fs.writeFileSync('$config_file', JSON.stringify(config, null, 2) + '\n');
  "
}

# Check if server already configured in a JSON file
check_json_server_exists() {
  local config_file="$1"
  local server_name="planning-game-${INSTANCE_NAME}"
  [ -f "$config_file" ] && grep -q "\"$server_name\"" "$config_file" 2>/dev/null
}

# Standard pre-configure check: exists? backup? reconfigure?
# Returns 0 to proceed, 1 to skip
pre_configure_check() {
  local client_name="$1"
  local config_file="$2"
  local server_name="planning-game-${INSTANCE_NAME}"

  echo ""
  print_info "Configuring $client_name..."

  if check_json_server_exists "$config_file"; then
    print_warning "$server_name already configured in $client_name"
    read -p "Reconfigure? (y/n) " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && return 1

    if [ -f "$config_file" ]; then
      cp "$config_file" "$config_file.bak"
      print_info "Backup: $config_file.bak"
    fi
  fi
  return 0
}

# ─── Client configure functions ───────────────────────────────────────────────

# Codex (OpenAI) — TOML config
configure_codex_instance() {
  local server_name="planning-game-${INSTANCE_NAME}"
  local config_file="$HOME/.codex/config.toml"

  echo ""
  print_info "Configuring Codex..."

  mkdir -p "$HOME/.codex"

  if [ -f "$config_file" ] && grep -q "\[mcp_servers\.$server_name\]" "$config_file" 2>/dev/null; then
    print_warning "$server_name already configured in Codex"
    read -p "Reconfigure? (y/n) " -n 1 -r
    echo
    [[ ! $REPLY =~ ^[Yy]$ ]] && return 0
  fi

  node -e "
    const fs = require('fs');
    let lines = [];
    try { lines = fs.readFileSync('$config_file', 'utf8').split('\n'); } catch {}

    // Remove existing sections for this server
    const headers = ['[mcp_servers.$server_name]', '[mcp_servers.$server_name.env]'];
    let result = [];
    let skip = false;
    for (const line of lines) {
      if (headers.some(h => line.trim() === h)) { skip = true; continue; }
      if (skip && line.trim().startsWith('[')) skip = false;
      if (!skip) result.push(line);
    }
    while (result.length && result[result.length - 1].trim() === '') result.pop();

    result.push('');
    result.push('[mcp_servers.$server_name]');
    result.push('command = \"node\"');
    result.push('args = [\"$ENGINE_DIR/index.js\"]');
    result.push('');
    result.push('[mcp_servers.$server_name.env]');
    result.push('GOOGLE_APPLICATION_CREDENTIALS = \"$INSTANCE_DIR/serviceAccountKey.json\"');
    result.push('FIREBASE_DATABASE_URL = \"$FIREBASE_URL\"');
    result.push('MCP_INSTANCE_DIR = \"$INSTANCE_DIR\"');
    result.push('');

    fs.writeFileSync('$config_file', result.join('\n'));
  "

  print_success "Codex configured: $server_name"
}

# Cursor — JSON config
configure_cursor_instance() {
  local config_file="$HOME/.cursor/mcp.json"
  pre_configure_check "Cursor" "$config_file" || return 0

  write_json_mcp_config "$config_file" "mcpServers" '{
    "command": "node",
    "args": ["'"$ENGINE_DIR"'/index.js"],
    "env": '"$(get_server_env_json)"'
  }'

  print_success "Cursor configured: planning-game-${INSTANCE_NAME}"
}

# Windsurf — JSON config
configure_windsurf_instance() {
  local config_file="$HOME/.codeium/windsurf/mcp_config.json"
  pre_configure_check "Windsurf" "$config_file" || return 0

  write_json_mcp_config "$config_file" "mcpServers" '{
    "command": "node",
    "args": ["'"$ENGINE_DIR"'/index.js"],
    "env": '"$(get_server_env_json)"'
  }'

  print_success "Windsurf configured: planning-game-${INSTANCE_NAME}"
}

# Cline (VS Code) — JSON config
configure_cline_instance() {
  local config_dir="$HOME/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings"
  local config_file="$config_dir/cline_mcp_settings.json"

  # macOS path
  if [ "$(uname)" = "Darwin" ]; then
    config_dir="$HOME/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings"
    config_file="$config_dir/cline_mcp_settings.json"
  fi

  pre_configure_check "Cline" "$config_file" || return 0

  write_json_mcp_config "$config_file" "mcpServers" '{
    "command": "node",
    "args": ["'"$ENGINE_DIR"'/index.js"],
    "env": '"$(get_server_env_json)"',
    "alwaysAllow": [],
    "disabled": false
  }'

  print_success "Cline configured: planning-game-${INSTANCE_NAME}"
}

# Continue (VS Code/JetBrains) — YAML config
configure_continue_instance() {
  local server_name="planning-game-${INSTANCE_NAME}"
  local config_file="$HOME/.continue/config.yaml"

  echo ""
  print_info "Configuring Continue..."

  mkdir -p "$HOME/.continue"

  if [ -f "$config_file" ] && grep -q "name: $server_name" "$config_file" 2>/dev/null; then
    print_warning "$server_name already configured in Continue"
    read -p "Reconfigure? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      return 0
    fi
    cp "$config_file" "$config_file.bak"
    print_info "Backup: $config_file.bak"
  fi

  # Use Python if available (safe YAML manipulation), fallback to append
  if python3 -c "import yaml" 2>/dev/null; then
    python3 -c "
import yaml

config_file = '$config_file'
try:
    with open(config_file) as f:
        config = yaml.safe_load(f) or {}
except:
    config = {}

servers = config.get('mcpServers', [])
if not isinstance(servers, list):
    servers = []
servers = [s for s in servers if s.get('name') != '$server_name']
servers.append({
    'name': '$server_name',
    'type': 'stdio',
    'command': 'node',
    'args': ['$ENGINE_DIR/index.js'],
    'env': {
        'GOOGLE_APPLICATION_CREDENTIALS': '$INSTANCE_DIR/serviceAccountKey.json',
        'FIREBASE_DATABASE_URL': '$FIREBASE_URL',
        'MCP_INSTANCE_DIR': '$INSTANCE_DIR'
    }
})
config['mcpServers'] = servers

with open(config_file, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, sort_keys=False)
"
  else
    # Fallback: append YAML block manually
    if [ ! -f "$config_file" ] || ! grep -q "^mcpServers:" "$config_file" 2>/dev/null; then
      echo "" >> "$config_file"
      echo "mcpServers:" >> "$config_file"
    fi
    cat >> "$config_file" <<YAMLBLOCK
  - name: ${server_name}
    type: stdio
    command: node
    args:
      - "${ENGINE_DIR}/index.js"
    env:
      GOOGLE_APPLICATION_CREDENTIALS: "${INSTANCE_DIR}/serviceAccountKey.json"
      FIREBASE_DATABASE_URL: "${FIREBASE_URL}"
      MCP_INSTANCE_DIR: "${INSTANCE_DIR}"
YAMLBLOCK
  fi

  print_success "Continue configured: $server_name"
}

# Gemini CLI — JSON config
configure_gemini_instance() {
  local config_file="$HOME/.gemini/settings.json"
  pre_configure_check "Gemini CLI" "$config_file" || return 0

  write_json_mcp_config "$config_file" "mcpServers" '{
    "command": "node",
    "args": ["'"$ENGINE_DIR"'/index.js"],
    "env": '"$(get_server_env_json)"'
  }'

  print_success "Gemini CLI configured: planning-game-${INSTANCE_NAME}"
}

# Amazon Q CLI — JSON config
configure_amazonq_instance() {
  local config_file="$HOME/.aws/amazonq/mcp.json"
  pre_configure_check "Amazon Q CLI" "$config_file" || return 0

  write_json_mcp_config "$config_file" "mcpServers" '{
    "command": "node",
    "args": ["'"$ENGINE_DIR"'/index.js"],
    "env": '"$(get_server_env_json)"'
  }'

  print_success "Amazon Q CLI configured: planning-game-${INSTANCE_NAME}"
}

# Roo Code (VS Code) — JSON config
configure_roo_instance() {
  local config_dir="$HOME/.config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings"
  local config_file="$config_dir/mcp_settings.json"

  # macOS path
  if [ "$(uname)" = "Darwin" ]; then
    config_dir="$HOME/Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings"
    config_file="$config_dir/mcp_settings.json"
  fi

  pre_configure_check "Roo Code" "$config_file" || return 0

  write_json_mcp_config "$config_file" "mcpServers" '{
    "command": "node",
    "args": ["'"$ENGINE_DIR"'/index.js"],
    "env": '"$(get_server_env_json)"',
    "alwaysAllow": [],
    "disabled": false
  }'

  print_success "Roo Code configured: planning-game-${INSTANCE_NAME}"
}

install_guidelines() {
  echo ""
  local templates_dir="$ENGINE_DIR/templates"
  local guidelines_src="$templates_dir/CLAUDE.md"
  local memory_src="$templates_dir/MEMORY.md"
  local geniova_marker="Geniova Technologies - Development Guidelines"

  if [ ! -f "$guidelines_src" ]; then
    print_warning "Guidelines template not found in $templates_dir, skipping"
    return 0
  fi

  # Install a guidelines file to a target path
  # Usage: install_guideline_file <source> <target> <marker_text>
  install_guideline_file() {
    local src="$1"
    local target="$2"
    local marker="$3"

    mkdir -p "$(dirname "$target")"

    if [ -f "$target" ]; then
      if grep -q "$marker" "$target" 2>/dev/null; then
        cp "$src" "$target"
        print_success "Updated: $target"
      else
        read -p "  $target exists with custom content. Overwrite? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
          cp "$target" "$target.bak"
          cp "$src" "$target"
          print_success "Updated: $target (backup: .bak)"
        else
          print_warning "Skipped: $target"
        fi
      fi
    else
      cp "$src" "$target"
      print_success "Installed: $target"
    fi
  }

  # Always install Claude guidelines (base format)
  print_info "Installing development guidelines..."

  install_guideline_file "$guidelines_src" "$HOME/.claude/CLAUDE.md" "$geniova_marker"
  if [ -f "$memory_src" ]; then
    install_guideline_file "$memory_src" "$HOME/.claude/MEMORY.md" "Geniova Technologies - Knowledge Base"
  fi

  # Install for Codex (AGENTS.md)
  if client_selected codex; then
    install_guideline_file "$guidelines_src" "$HOME/.codex/AGENTS.md" "$geniova_marker"
  fi

  # Install for OpenCode (AGENTS.md)
  if client_selected opencode; then
    install_guideline_file "$guidelines_src" "$HOME/.config/opencode/AGENTS.md" "$geniova_marker"
  fi

  # Install for Gemini CLI (GEMINI.md)
  if client_selected gemini; then
    install_guideline_file "$guidelines_src" "$HOME/.gemini/GEMINI.md" "$geniova_marker"
  fi

  # Install for Windsurf (global rules)
  if client_selected windsurf; then
    install_guideline_file "$guidelines_src" "$HOME/.codeium/windsurf/memories/global_rules.md" "$geniova_marker"
  fi

  # Install for Cline (Rules directory)
  if client_selected cline; then
    local cline_rules="$HOME/Documents/Cline/Rules"
    mkdir -p "$cline_rules"
    install_guideline_file "$guidelines_src" "$cline_rules/geniova-guidelines.md" "$geniova_marker"
  fi

  # Install for Roo Code (rules directory)
  if client_selected roo; then
    mkdir -p "$HOME/.roo/rules"
    install_guideline_file "$guidelines_src" "$HOME/.roo/rules/geniova-guidelines.md" "$geniova_marker"
  fi

  # Install for Amazon Q (rules directory)
  if client_selected amazonq; then
    mkdir -p "$HOME/.amazonq/rules"
    install_guideline_file "$guidelines_src" "$HOME/.amazonq/rules/geniova-guidelines.md" "$geniova_marker"
  fi
}

setup_mcp_user() {
  echo ""
  print_info "Configure your MCP user identity (used for createdBy/updatedBy tracking)"
  echo ""
  echo "  You can also configure this later by asking your AI: \"setup_mcp_user\""
  echo ""
  read -p "Configure now? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    return 0
  fi

  echo ""
  read -p "Your developer ID (e.g., dev_010): " dev_id
  if [ -z "$dev_id" ]; then
    print_warning "Skipped user configuration"
    return 0
  fi

  read -p "Your name: " dev_name
  read -p "Your email: " dev_email

  local user_file="$INSTANCE_DIR/mcp.user.json"
  cat > "$user_file" << USERDATA
{
  "developerId": "$dev_id",
  "stakeholderId": null,
  "name": "$dev_name",
  "email": "$dev_email"
}
USERDATA

  print_success "Created: $user_file"
  print_info "Use setup_mcp_user tool from AI to auto-match your stakeholderId"
}

print_next_steps() {
  local server_name="planning-game-${INSTANCE_NAME}"

  echo ""
  echo -e "${BLUE}========================================"
  echo -e "  Installation Complete!"
  echo -e "========================================${NC}"
  echo ""
  echo "  Instance:  $INSTANCE_NAME"
  echo "  Engine:    $ENGINE_DIR"
  echo "  Config:    $INSTANCE_DIR"
  echo "  Server:    $server_name"

  if [ ${#SELECTED_CLIENTS[@]} -gt 0 ]; then
    echo "  Clients:   ${SELECTED_CLIENTS[*]}"
  fi
  echo ""

  local step=1

  if [ ! -f "$INSTANCE_DIR/serviceAccountKey.json" ]; then
    echo "  $step. Copy serviceAccountKey.json to:"
    echo "     $INSTANCE_DIR/"
    echo ""
    ((step++))
  fi

  if [ ! -f "$INSTANCE_DIR/mcp.user.json" ]; then
    echo "  $step. Configure your user identity:"
    echo "     Ask your AI: \"setup_mcp_user\""
    echo ""
    ((step++))
  fi

  echo "  $step. Restart your MCP client(s) to load the new config"
  echo ""
  ((step++))

  echo "  To add another instance, run this script again."
}

# Main installation flow
main() {
  print_header
  check_dependencies
  ensure_engine
  ask_instance_name
  create_instance
  select_clients

  # Configure selected clients
  client_selected claude    && configure_claude_instance
  client_selected opencode  && configure_opencode_instance
  client_selected codex     && configure_codex_instance
  client_selected cursor    && configure_cursor_instance
  client_selected windsurf  && configure_windsurf_instance
  client_selected cline     && configure_cline_instance
  client_selected continue  && configure_continue_instance
  client_selected gemini    && configure_gemini_instance
  client_selected amazonq   && configure_amazonq_instance
  client_selected roo       && configure_roo_instance

  if [ ${#SELECTED_CLIENTS[@]} -eq 0 ]; then
    show_instance_config
  fi

  install_guidelines
  setup_mcp_user
  print_next_steps
}

# Run main
main "$@"

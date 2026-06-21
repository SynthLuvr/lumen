#!/usr/bin/env bash
#
# Lumen — Project Setup Helper
#
# Automates setup from lumen-cli/README.md:
#   1. Verifies prerequisites (uv, Node.js, pnpm, Docker)
#   2. Starts Chroma via Docker
#   3. Installs Node dependencies
#   4. Symlinks the `lumen` launcher onto the PATH
#   5. Runs `lumen ingest` to populate the vector database
#
# Compatible with Linux and macOS. Windows is NOT supported — use WSL2.
#
# Usage:  ./setup.sh    (run from the repository root)
# Re-running is safe — every step is idempotent.

set -euo pipefail

# ─── Output helpers ───────────────────────────────────────────

if [ -t 1 ]; then
  BOLD=$'\033[1m' DIM=$'\033[2m' GREEN=$'\033[32m' RED=$'\033[31m'
  YELLOW=$'\033[33m' BLUE=$'\033[34m' CYAN=$'\033[36m' RESET=$'\033[0m'
else
  BOLD="" DIM="" GREEN="" RED="" YELLOW="" BLUE="" CYAN="" RESET=""
fi

info()    { printf '%s▶%s %s\n'  "${BLUE}"   "${RESET}" "$*"; }
success() { printf '%s✔%s %s\n' "${GREEN}"  "${RESET}" "$*"; }
warn()    { printf '%s⚠%s %s\n' "${YELLOW}" "${RESET}" "$*"; }
error()   { printf '%s✘%s %s\n' "${RED}"    "${RESET}" "$*" >&2; }
die()     { error "$*"; exit 1; }

heading() {
  printf '\n%s━━━ %s ━━━%s\n' "${BOLD}${CYAN}" "$*" "${RESET}"
}

# ─── Utility functions ────────────────────────────────────────

command_exists() { command -v "$1" >/dev/null 2>&1; }

dir_on_path() {
  echo "$PATH" | tr ':' '\n' | grep -qx "$1"
}

# Strip a leading 'v' (e.g. "v20.3.1") then take the first dot-delimited field.
major_version() {
  echo "$1" | sed 's/^v//' | cut -d. -f1
}

# ─── Step 0: Platform check ───────────────────────────────────

check_platform() {
  heading "Platform Check"
  local os_type
  os_type="$(uname -s)"
  case "$os_type" in
    Linux*|Darwin*)
      success "Running on $os_type"
      ;;
    MINGW*|MSYS*|CYGWIN*|*Windows*)
      die "Windows is not supported. Please use WSL2 (Ubuntu) or a Linux VM, then run this script from inside it."
      ;;
    *)
      die "Unrecognised platform '$os_type'. This script supports Linux and macOS only."
      ;;
  esac
}

# ─── Step 0a: Locate project root ─────────────────────────────

resolve_project_root() {
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"

  if [ -d "$script_dir/lumen-cli" ]; then
    PROJECT_ROOT="$script_dir"
  elif [ -d "$script_dir/../lumen-cli" ] && [ -f "$script_dir/package.json" ]; then
    PROJECT_ROOT="$(cd "$script_dir/.." && pwd)"
  else
    die "Cannot find 'lumen-cli/' directory relative to '$script_dir'. Please run this script from the repository root (the parent of lumen-cli/)."
  fi
  LUMEN_CLI_DIR="$PROJECT_ROOT/lumen-cli"
  info "Project root: $PROJECT_ROOT"
  info "Lumen CLI:    $LUMEN_CLI_DIR"
}

# ─── Step 1: Check prerequisites ──────────────────────────────

check_uv() {
  heading "Checking for uv (Python package manager)"

  if command_exists uv; then
    success "uv found — $(uv --version 2>/dev/null || echo 'unknown')"
    return
  fi

  warn "uv is not installed."
  echo ""
  echo "  uv is required by the NHS and Healf crawlers."
  echo "  Install it with one of these methods:"
  echo ""
  echo "    ${DIM}# macOS / Linux (recommended):${RESET}"
  echo "    curl -LsSf https://astral.sh/uv/install.sh | sh"
  echo ""
  echo "    ${DIM}# macOS via Homebrew:${RESET}"
  echo "    brew install uv"
  echo ""
  echo "  See: https://docs.astral.sh/uv/getting-started/installation/"
  echo ""
  printf 'Install uv now and re-run this script. %sContinue anyway? [y/N]%s ' "$YELLOW" "$RESET"
  local response=""
  read -r response || true
  case "$response" in
    [yY]|[yY][eE][sS])
      warn "Continuing without uv — crawler setup steps will be skipped."
      ;;
    *)
      die "Aborting. Please install uv and re-run."
      ;;
  esac
}

check_node() {
  heading "Checking for Node.js"

  if ! command_exists node; then
    echo ""
    echo "  Node.js (≥ 20) is required to run Lumen."
    echo "  Install it with one of these methods:"
    echo ""
    echo "    ${DIM}# macOS via Homebrew:${RESET}"
    echo "    brew install node@20"
    echo ""
    echo "    ${DIM}# Linux (nvm — recommended):${RESET}"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
    echo "    nvm install 20 && nvm use 20"
    echo ""
    echo "    ${DIM}# Or download directly:${RESET}"
    echo "    https://nodejs.org/en/download"
    echo ""
    die "Please install Node.js ≥ 20 and re-run this script."
  fi

  local node_version node_major
  node_version="$(node --version 2>/dev/null || echo 'unknown')"
  node_major="$(major_version "$node_version")"
  if [ "$node_major" -ge 20 ] 2>/dev/null; then
    success "Node.js found — $node_version (≥ 20 ✓)"
  else
    warn "Node.js found ($node_version) but version < 20. Lumen requires Node.js ≥ 20."
    warn "Please upgrade: https://nodejs.org/en/download"
    die "Node.js ≥ 20 is required."
  fi
}

check_pnpm() {
  heading "Checking for pnpm"

  if ! command_exists pnpm; then
    echo ""
    echo "  pnpm (≥ 10) is required to install Lumen's dependencies."
    echo "  Install it with one of these methods:"
    echo ""
    echo "    ${DIM}# Via npm (simplest, requires Node.js):${RESET}"
    echo "    npm install -g pnpm@latest"
    echo ""
    echo "    ${DIM}# macOS via Homebrew:${RESET}"
    echo "    brew install pnpm"
    echo ""
    echo "    ${DIM}# Via corepack (bundled with Node.js):${RESET}"
    echo "    corepack enable && corepack prepare pnpm@latest --activate"
    echo ""
    echo "  See: https://pnpm.io/installation"
    echo ""
    die "Please install pnpm ≥ 10 and re-run this script."
  fi

  local pnpm_version pnpm_major
  pnpm_version="$(pnpm --version 2>/dev/null || echo 'unknown')"
  pnpm_major="$(major_version "$pnpm_version")"
  if [ "$pnpm_major" -ge 10 ] 2>/dev/null; then
    success "pnpm found — v$pnpm_version (≥ 10 ✓)"
  else
    warn "pnpm found (v$pnpm_version) but version < 10. Lumen requires pnpm ≥ 10."
    warn "Upgrading: ${DIM}npm install -g pnpm@latest${RESET}"
    die "Please upgrade pnpm to ≥ 10 and re-run."
  fi
}

check_docker() {
  heading "Checking for Docker"

  if ! command_exists docker; then
    echo ""
    echo "  Docker is required to run Chroma (the vector database)."
    echo "  Install it with one of these methods:"
    echo ""
    echo "    ${DIM}# macOS:${RESET}"
    echo "    brew install --cask docker"
    echo "    ${DIM}# Then launch Docker Desktop from Applications${RESET}"
    echo ""
    echo "    ${DIM}# Linux (Ubuntu/Debian):${RESET}"
    echo "    curl -fsSL https://get.docker.com | sh"
    echo "    sudo usermod -aG docker \$USER"
    echo "    ${DIM}# Log out and back in for the group change to take effect${RESET}"
    echo ""
    echo "    ${DIM}# Or download Docker Desktop:${RESET}"
    echo "    https://www.docker.com/products/docker-desktop/"
    echo ""
    die "Please install Docker and re-run this script."
  fi

  success "Docker found — $(docker --version 2>/dev/null || echo 'unknown')"

  if docker info >/dev/null 2>&1; then
    success "Docker daemon is running"
  else
    warn "Docker is installed but the daemon is not running."
    warn "Please start Docker Desktop (macOS) or the docker service (Linux), then re-run."
    die "Docker daemon must be running to start Chroma."
  fi
}

# ─── Step 2: Start Chroma via Docker ──────────────────────────

start_chroma() {
  heading "Starting Chroma Vector Database"

  local container="chroma-dev"
  local port="${CHROMA_PORT:-8000}"
  local data_dir="$LUMEN_CLI_DIR/chroma_data"
  local heartbeat_url="http://localhost:$port/api/v2/heartbeat"

  # Check if something is already serving Chroma on the port — this could be
  # a separately-managed container (differently named), a native install, or
  # a remote Chroma reachable via a tunnel.  If so, trust it and move on;
  # attempting `docker run` here would fail with "port is already allocated".
  if curl -sf "$heartbeat_url" >/dev/null 2>&1; then
    success "Chroma is already running on port $port"
    return
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
    success "Chroma container '$container' is already running"
  elif docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
    info "Starting existing (stopped) Chroma container '$container'..."
    docker start "$container" >/dev/null
    success "Chroma container started"
  else
    info "Creating new Chroma container '$container'..."
    info "  Port:  $port"
    info "  Data:  $data_dir"
    mkdir -p "$data_dir"
    docker run -d \
      --name "$container" \
      -p "$port:8000" \
      -v "$data_dir:/chroma/chroma" \
      chromadb/chroma:latest >/dev/null
    success "Chroma container created and started"
  fi

  info "Waiting for Chroma to respond on port $port..."
  local ready=false
  for _ in $(seq 1 30); do
    if curl -sf "http://localhost:$port/api/v2/heartbeat" >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done

  if [ "$ready" = true ]; then
    success "Chroma is up and responding (port $port)"
  else
    die "Chroma did not become ready within 30 seconds. Check: docker logs $container"
  fi
}

# ─── Step 3: Install Node dependencies ────────────────────────

install_node_dependencies() {
  heading "Installing Node Dependencies (pnpm install)"

  info "Working directory: $LUMEN_CLI_DIR"
  cd "$LUMEN_CLI_DIR"

  if [ -d "node_modules" ] && [ -f "pnpm-lock.yaml" ]; then
    info "node_modules exists — running pnpm install to ensure everything is current..."
  else
    info "Running pnpm install (first time)..."
  fi

  # Try the lockfile first; fall back to a relaxed install if the lockfile
  # is out of sync (e.g. after a git pull that changed dependencies).
  if pnpm install --frozen-lockfile 2>/dev/null || pnpm install; then
    success "Dependencies installed"
  else
    die "pnpm install failed. See output above."
  fi
}

# ─── Step 4: Create `lumen` symlink ───────────────────────────

setup_lumen_symlink() {
  heading "Setting Up \`lumen\` Command"

  local bin_dir="$HOME/.local/bin"
  local lumen_bin="$LUMEN_CLI_DIR/bin/lumen"
  local symlink_path="$bin_dir/lumen"

  BIN_DIR="$bin_dir"
  SYMLINK_PATH="$symlink_path"

  mkdir -p "$bin_dir"

  if ! dir_on_path "$bin_dir"; then
    warn "$bin_dir is not on your PATH."
    echo ""
    echo "  Add this line to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo ""
    echo "    export PATH=\"$bin_dir:\$PATH\""
    echo ""
    echo "  Then restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
    echo ""
  fi

  if [ -L "$symlink_path" ] && [ "$(readlink "$symlink_path" 2>/dev/null || true)" = "$lumen_bin" ]; then
    success "Symlink already correct — $symlink_path → $lumen_bin"
  else
    if [ -e "$symlink_path" ] || [ -L "$symlink_path" ]; then
      info "Updating existing symlink to point to this project..."
      rm -f "$symlink_path"
      ln -s "$lumen_bin" "$symlink_path"
      success "Symlink updated — $symlink_path → $lumen_bin"
    else
      ln -s "$lumen_bin" "$symlink_path"
      success "Symlink created — $symlink_path → $lumen_bin"
    fi
  fi
}

# ─── Step 5: Run `lumen ingest` ───────────────────────────────

run_ingest() {
  heading "Ingesting Documents into Chroma"

  info "Running: lumen ingest"
  info "(This may take a few minutes on first run — the embedding model needs to download ~25 MB)"

  if command_exists lumen; then
    if lumen ingest; then
      success "Document ingestion complete"
    else
      die "lumen ingest failed. See output above for details."
    fi
  else
    info "lumen not on PATH yet — invoking directly: $LUMEN_CLI_DIR/bin/lumen"
    if "$LUMEN_CLI_DIR/bin/lumen" ingest; then
      success "Document ingestion complete"
    else
      die "lumen ingest failed. See output above for details."
    fi
  fi
}

# ─── Done ─────────────────────────────────────────────────────

print_next_steps() {
  heading "Setup Complete!"

  echo ""
  printf '%sLumen is ready to use!%s\n' "${BOLD}${GREEN}" "${RESET}"
  echo ""
  echo "  Get started:"
  echo ""
  echo "    ${BOLD}lumen --help${RESET}             # see all available commands"
  echo "    ${BOLD}lumen question${RESET}           # ask your question right away"
  echo ""
  echo "  Before using 'lumen question', make sure OPENAI_API_KEY is set:"
  echo ""
  echo "    export OPENAI_API_KEY=\"sk-...\""
  echo ""
  if ! dir_on_path "$BIN_DIR"; then
    echo "  ${YELLOW}Note:${RESET} $BIN_DIR is not on your PATH."
    echo "  Add it to your shell profile or invoke lumen via the full path:"
    echo "    $SYMLINK_PATH --help"
    echo ""
  fi
}

# ─── Main ─────────────────────────────────────────────────────

main() {
  check_platform
  resolve_project_root
  check_uv
  check_node
  check_pnpm
  check_docker
  start_chroma
  install_node_dependencies
  setup_lumen_symlink
  run_ingest
  print_next_steps
}

main "$@"

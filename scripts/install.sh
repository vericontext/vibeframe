#!/bin/bash
#
# VibeEdit Installer
# curl -fsSL https://vibe-edit.dev/install.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Installation directory
VIBE_HOME="${VIBE_HOME:-$HOME/.vibe-edit}"

# Print banner
banner() {
  echo ""
  echo -e "${MAGENTA} ██╗   ██╗██╗██████╗ ███████╗${NC}"
  echo -e "${MAGENTA} ██║   ██║██║██╔══██╗██╔════╝${NC}"
  echo -e "${MAGENTA} ╚██╗ ██╗██║██████╔╝█████╗  ${NC}"
  echo -e "${MAGENTA}  ╚████╔╝██║██████╔╝███████╗${NC}  ${DIM}edit${NC}"
  echo -e "${MAGENTA}   ╚═══╝ ╚═╝╚═════╝ ╚══════╝${NC}"
  echo ""
  echo -e "${DIM}AI-First Video Editor${NC}"
  echo ""
}

# Print step
step() {
  echo -e "${GREEN}→${NC} $1"
}

# Print error
error() {
  echo -e "${RED}✗${NC} $1" >&2
}

# Print warning
warn() {
  echo -e "${YELLOW}!${NC} $1"
}

# Check command exists
check_cmd() {
  command -v "$1" >/dev/null 2>&1
}

# Get Node.js version
node_version() {
  node --version 2>/dev/null | sed 's/v//' | cut -d. -f1
}

banner

# Check dependencies
step "Checking dependencies..."

# Node.js
if ! check_cmd node; then
  error "Node.js is required but not installed."
  echo ""
  echo "Install Node.js 18+ from: https://nodejs.org"
  echo "Or use nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  exit 1
fi

NODE_VER=$(node_version)
if [ "$NODE_VER" -lt 18 ]; then
  error "Node.js 18+ is required. You have v$NODE_VER."
  exit 1
fi
echo -e "  ${DIM}Node.js v$(node --version | sed 's/v//')${NC}"

# Git
if ! check_cmd git; then
  error "Git is required but not installed."
  echo ""
  echo "Install git from: https://git-scm.com"
  exit 1
fi
echo -e "  ${DIM}Git $(git --version | cut -d' ' -f3)${NC}"

# FFmpeg (optional but recommended)
if check_cmd ffmpeg; then
  echo -e "  ${DIM}FFmpeg $(ffmpeg -version 2>&1 | head -1 | cut -d' ' -f3)${NC}"
else
  warn "FFmpeg not found. Some features may not work."
  echo -e "  ${DIM}Install: brew install ffmpeg (macOS) or apt install ffmpeg (Ubuntu)${NC}"
fi

echo ""

# Check if already installed
if [ -d "$VIBE_HOME" ]; then
  step "Updating existing installation..."
  cd "$VIBE_HOME"
  git pull origin main
else
  step "Cloning VibeEdit..."
  git clone --depth 1 https://github.com/vericontext/vibe-edit.git "$VIBE_HOME"
  cd "$VIBE_HOME"
fi

echo ""

# Install pnpm if needed
if ! check_cmd pnpm; then
  step "Installing pnpm..."
  npm install -g pnpm
fi

# Install dependencies
step "Installing dependencies..."
pnpm install

# Build
step "Building..."
pnpm build

echo ""

# Create symlink
step "Creating symlink..."
BIN_PATH="/usr/local/bin/vibe"

# Try to create symlink
if [ -w "/usr/local/bin" ]; then
  ln -sf "$VIBE_HOME/packages/cli/dist/index.js" "$BIN_PATH"
  chmod +x "$BIN_PATH"
  echo -e "  ${DIM}Linked to $BIN_PATH${NC}"
else
  # Need sudo
  warn "Need sudo to create symlink in /usr/local/bin"
  sudo ln -sf "$VIBE_HOME/packages/cli/dist/index.js" "$BIN_PATH"
  sudo chmod +x "$BIN_PATH"
  echo -e "  ${DIM}Linked to $BIN_PATH${NC}"
fi

echo ""
echo -e "${GREEN}✓${NC} Installation complete!"
echo ""
echo -e "${DIM}─────────────────────────────────────────${NC}"
echo ""
echo "Quick start:"
echo ""
echo -e "  ${GREEN}vibe setup${NC}    # Configure API keys"
echo -e "  ${GREEN}vibe${NC}          # Start interactive mode"
echo -e "  ${GREEN}vibe --help${NC}   # Show all commands"
echo ""

# Ask to run setup
echo -e "${DIM}─────────────────────────────────────────${NC}"
echo ""
read -p "Run setup wizard now? (Y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Nn]$ ]]; then
  echo ""
  vibe setup
fi

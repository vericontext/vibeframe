#!/bin/bash
#
# VibeFrame Installer
#
# Default (CLI-only, fastest):
#   curl -fsSL https://vibeframe.ai/install.sh | bash
#
# Full installation (includes web UI):
#   curl -fsSL https://vibeframe.ai/install.sh | bash -s -- --full
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Installation directory
VIBE_HOME="${VIBE_HOME:-$HOME/.vibeframe}"

# Default options
FULL_INSTALL=false
SKIP_SETUP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --full)
      FULL_INSTALL=true
      shift
      ;;
    --skip-setup)
      SKIP_SETUP=true
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Print banner
banner() {
  echo ""
  echo -e "${MAGENTA}██╗   ██╗██╗██████╗ ███████╗${NC}  ${MAGENTA}███████╗██████╗  █████╗ ███╗   ███╗███████╗${NC}"
  echo -e "${MAGENTA}██║   ██║██║██╔══██╗██╔════╝${NC}  ${MAGENTA}██╔════╝██╔══██╗██╔══██╗████╗ ████║██╔════╝${NC}"
  echo -e "${MAGENTA}██║   ██║██║██████╔╝█████╗  ${NC}  ${MAGENTA}█████╗  ██████╔╝███████║██╔████╔██║█████╗  ${NC}"
  echo -e "${MAGENTA}╚██╗ ██╔╝██║██╔══██╗██╔══╝  ${NC}  ${MAGENTA}██╔══╝  ██╔══██╗██╔══██║██║╚██╔╝██║██╔══╝  ${NC}"
  echo -e "${MAGENTA} ╚████╔╝ ██║██████╔╝███████╗${NC}  ${MAGENTA}██║     ██║  ██║██║  ██║██║ ╚═╝ ██║███████╗${NC}"
  echo -e "${MAGENTA}  ╚═══╝  ╚═╝╚═════╝ ╚══════╝${NC}  ${MAGENTA}╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝${NC}"
  echo ""
  echo -e "${DIM}AI-First Video Editor${NC}"
  if [ "$FULL_INSTALL" = true ]; then
    echo -e "${DIM}Full installation (CLI + Web UI)${NC}"
  else
    echo -e "${DIM}CLI installation${NC}"
  fi
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
  # Check for subtitle/text support (needed for caption command)
  if ! ffmpeg -filters 2>/dev/null | grep -q "subtitles"; then
    warn "FFmpeg missing subtitle support (libass). Caption command won't work."
    if [[ "$OSTYPE" == "darwin"* ]]; then
      echo -e "  ${DIM}Fix: brew uninstall ffmpeg && brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass --with-freetype${NC}"
    else
      echo -e "  ${DIM}Fix: sudo apt install libass-dev && sudo apt install --reinstall ffmpeg${NC}"
    fi
  fi
else
  warn "FFmpeg not found. Some features may not work."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo -e "  ${DIM}Install: brew install homebrew-ffmpeg/ffmpeg/ffmpeg --with-libass --with-freetype${NC}"
  else
    echo -e "  ${DIM}Install: sudo apt install ffmpeg${NC}"
  fi
fi

echo ""

# Check if already installed
if [ -d "$VIBE_HOME" ]; then
  step "Updating existing installation..."
  cd "$VIBE_HOME"
  git pull origin main
else
  step "Cloning VibeFrame..."
  git clone --depth 1 https://github.com/vericontext/vibeframe.git "$VIBE_HOME"
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
if [ "$FULL_INSTALL" = true ]; then
  step "Building all packages..."
  pnpm build
else
  step "Building CLI packages..."
  # Build only CLI-related packages (faster)
  pnpm --filter @vibeframe/core build
  pnpm --filter @vibeframe/ai-providers build
  pnpm --filter @vibeframe/mcp-server build
  pnpm --filter @vibeframe/cli build
fi

echo ""

# Create symlink - prefer ~/.local/bin (no sudo), fall back to /usr/local/bin
step "Creating symlink..."

# Ensure ~/.local/bin exists and is in PATH
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
  # Add to shell rc file
  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
  fi

  if [ -n "$SHELL_RC" ]; then
    if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$SHELL_RC" 2>/dev/null; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
      warn "Added ~/.local/bin to PATH in $SHELL_RC"
      echo -e "  ${DIM}Run: source $SHELL_RC${NC}"
    fi
  fi
fi

# Create symlink in ~/.local/bin (no sudo needed)
BIN_PATH="$LOCAL_BIN/vibe"
ln -sf "$VIBE_HOME/packages/cli/dist/index.js" "$BIN_PATH"
chmod +x "$BIN_PATH"
echo -e "  ${DIM}Linked to $BIN_PATH${NC}"

# Also try /usr/local/bin if writable (for system-wide access)
if [ -w "/usr/local/bin" ]; then
  ln -sf "$VIBE_HOME/packages/cli/dist/index.js" "/usr/local/bin/vibe"
  chmod +x "/usr/local/bin/vibe"
  echo -e "  ${DIM}Also linked to /usr/local/bin/vibe${NC}"
fi

echo ""
echo -e "${GREEN}✓${NC} Installation complete!"
echo ""
echo -e "${DIM}─────────────────────────────────────────${NC}"
echo ""

if [ "$FULL_INSTALL" = true ]; then
  echo "Quick start:"
  echo ""
  echo -e "  ${CYAN}vibe setup${NC}         # Configure API keys"
  echo -e "  ${CYAN}vibe setup --show${NC}  # Verify configuration"
  echo -e "  ${CYAN}vibe${NC}               # Start CLI mode"
  echo -e "  ${CYAN}pnpm dev${NC}           # Start web UI (http://localhost:3000)"
  echo -e "  ${CYAN}vibe --help${NC}        # Show all commands"
else
  echo "Quick start:"
  echo ""
  echo -e "  ${CYAN}vibe setup${NC}         # Configure API keys"
  echo -e "  ${CYAN}vibe setup --show${NC}  # Verify configuration"
  echo -e "  ${CYAN}vibe${NC}               # Start interactive mode"
  echo -e "  ${CYAN}vibe --help${NC}        # Show all commands"
  echo ""
  echo -e "${DIM}Want web UI? Reinstall with: curl ... | bash -s -- --full${NC}"
fi
echo ""

# Ask to run setup (unless skipped)
if [ "$SKIP_SETUP" = false ]; then
  echo -e "${DIM}─────────────────────────────────────────${NC}"
  echo ""
  read -p "Run setup wizard now? (Y/n) " -n 1 -r < /dev/tty
  echo ""

  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo ""
    vibe setup < /dev/tty
  fi
fi

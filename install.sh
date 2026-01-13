#!/bin/sh
# CCC - Coding Container CLI installer
# Usage: curl -fsSL https://raw.githubusercontent.com/your-repo/ccc/main/install.sh | sh

set -e

INSTALL_DIR="${HOME}/.local/bin"
REPO_URL="https://github.com/adrianleb/ccc"
BINARY_NAME="ccc"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
DIM='\033[2m'
RESET='\033[0m'

info() { printf "${BLUE}→${RESET} %s\n" "$1"; }
success() { printf "${GREEN}✓${RESET} %s\n" "$1"; }
error() { printf "${RED}✗${RESET} %s\n" "$1" >&2; exit 1; }

# Detect OS and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case "$ARCH" in
        x86_64) ARCH="x64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac

    case "$OS" in
        darwin) PLATFORM="darwin-${ARCH}" ;;
        linux) PLATFORM="linux-${ARCH}" ;;
        *) error "Unsupported OS: $OS" ;;
    esac
}

# Check for required tools
check_requirements() {
    if ! command -v docker >/dev/null 2>&1; then
        printf "${DIM}Note: Docker not found. You'll need it before running 'ccc init'.${RESET}\n"
    fi
}

# Create install directory
setup_dir() {
    if [ ! -d "$INSTALL_DIR" ]; then
        info "Creating $INSTALL_DIR"
        mkdir -p "$INSTALL_DIR"
    fi
}

# Download and install binary
install_binary() {
    info "Downloading ccc for $PLATFORM..."

    # For now, build from source if bun is available
    if command -v bun >/dev/null 2>&1; then
        TEMP_DIR=$(mktemp -d)
        cd "$TEMP_DIR"

        info "Cloning repository..."
        git clone --depth 1 "$REPO_URL" . 2>/dev/null || error "Failed to clone repository"

        info "Installing dependencies..."
        bun install --silent

        info "Building binary..."
        bun build src/index.ts --compile --outfile "$INSTALL_DIR/$BINARY_NAME"

        cd - >/dev/null
        rm -rf "$TEMP_DIR"
    else
        # TODO: Download pre-built binary from releases
        error "Bun is required to build from source. Install it from https://bun.sh"
    fi
}

# Add to PATH if needed
setup_path() {
    case ":$PATH:" in
        *":$INSTALL_DIR:"*) return ;;
    esac

    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        zsh) RC_FILE="$HOME/.zshrc" ;;
        bash) RC_FILE="$HOME/.bashrc" ;;
        *) RC_FILE="" ;;
    esac

    if [ -n "$RC_FILE" ] && [ -f "$RC_FILE" ]; then
        if ! grep -q "$INSTALL_DIR" "$RC_FILE" 2>/dev/null; then
            printf '\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$RC_FILE"
            success "Added $INSTALL_DIR to PATH in $RC_FILE"
            printf "${DIM}   Run: source $RC_FILE${RESET}\n"
        fi
    else
        printf "${DIM}Add this to your shell config:${RESET}\n"
        printf "   export PATH=\"%s:\$PATH\"\n" "$INSTALL_DIR"
    fi
}

main() {
    printf "\n${BLUE}Installing CCC - Coding Container CLI${RESET}\n\n"

    detect_platform
    check_requirements
    setup_dir
    install_binary
    setup_path

    printf "\n${GREEN}✓ Installation complete!${RESET}\n\n"
    printf "Get started:\n"
    printf "   ${BLUE}ccc init${RESET}     Set up your first container\n"
    printf "   ${BLUE}ccc${RESET}          Start coding\n"
    printf "   ${BLUE}ccc --help${RESET}   See all commands\n\n"
}

main

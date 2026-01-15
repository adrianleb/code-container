#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Functions
info() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}==>${NC} $1"; }
error() { echo -e "${RED}==>${NC} $1"; exit 1; }

# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' package.json | sed -E 's/.*"version": "([^"]+)".*/\1/')

# Parse arguments
VERSION=""
DRY_RUN=false
SKIP_TAG=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-tag)
      SKIP_TAG=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [version] [options]"
      echo ""
      echo "Arguments:"
      echo "  version      Version to release (e.g., 0.2.0, patch, minor, major)"
      echo ""
      echo "Options:"
      echo "  --dry-run    Build binaries but don't create release"
      echo "  --skip-tag   Skip git tag creation (use existing tag)"
      echo "  -h, --help   Show this help message"
      echo ""
      echo "Examples:"
      echo "  $0 0.2.0           Release version 0.2.0"
      echo "  $0 patch           Bump patch version (0.1.0 -> 0.1.1)"
      echo "  $0 minor           Bump minor version (0.1.0 -> 0.2.0)"
      echo "  $0 major           Bump major version (0.1.0 -> 1.0.0)"
      echo "  $0 --dry-run       Build binaries without releasing"
      exit 0
      ;;
    *)
      VERSION="$1"
      shift
      ;;
  esac
done

# Calculate new version
calculate_version() {
  local current="$1"
  local bump="$2"

  IFS='.' read -r major minor patch <<< "$current"

  case $bump in
    major)
      echo "$((major + 1)).0.0"
      ;;
    minor)
      echo "${major}.$((minor + 1)).0"
      ;;
    patch)
      echo "${major}.${minor}.$((patch + 1))"
      ;;
    *)
      echo "$bump"
      ;;
  esac
}

if [[ -z "$VERSION" ]]; then
  VERSION=$(calculate_version "$CURRENT_VERSION" "patch")
  warn "No version specified, defaulting to patch bump: $VERSION"
fi

# Handle version bump keywords
case $VERSION in
  patch|minor|major)
    VERSION=$(calculate_version "$CURRENT_VERSION" "$VERSION")
    ;;
esac

info "Current version: $CURRENT_VERSION"
info "Release version: $VERSION"

# Validate version format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  error "Invalid version format: $VERSION (expected: X.Y.Z)"
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  warn "You have uncommitted changes"
  if [[ "$DRY_RUN" == false ]]; then
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 1
    fi
  fi
fi

# Check gh CLI is installed
if ! command -v gh &> /dev/null; then
  error "GitHub CLI (gh) is required. Install: brew install gh"
fi

# Check gh is authenticated
if ! gh auth status &> /dev/null; then
  error "GitHub CLI not authenticated. Run: gh auth login"
fi

# Build directory
BUILD_DIR="$PROJECT_DIR/dist"
mkdir -p "$BUILD_DIR"

# Platforms to build
PLATFORMS=(
  "linux-x64:bun-linux-x64"
  "linux-arm64:bun-linux-arm64"
  "darwin-x64:bun-darwin-x64"
  "darwin-arm64:bun-darwin-arm64"
)

info "Building binaries..."

for platform_target in "${PLATFORMS[@]}"; do
  IFS=':' read -r platform target <<< "$platform_target"
  binary_name="ccc-${platform}"

  info "  Building $binary_name..."
  bun build src/index.ts --compile --target="$target" --outfile "$BUILD_DIR/$binary_name"

  # Get file size
  size=$(ls -lh "$BUILD_DIR/$binary_name" | awk '{print $5}')
  success "  Built $binary_name ($size)"
done

# List built binaries
echo ""
info "Built binaries:"
ls -lh "$BUILD_DIR"/ccc-*

if [[ "$DRY_RUN" == true ]]; then
  echo ""
  success "Dry run complete! Binaries built in $BUILD_DIR"
  exit 0
fi

# Update version in package.json
info "Updating package.json version to $VERSION..."
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$VERSION\"/" package.json

# Create git tag
if [[ "$SKIP_TAG" == false ]]; then
  info "Creating git tag v$VERSION..."
  git add package.json
  git commit -m "Release v$VERSION"
  git tag -a "v$VERSION" -m "Release v$VERSION"

  info "Pushing to remote..."
  git push origin master
  git push origin "v$VERSION"
fi

# Create GitHub release
info "Creating GitHub release..."

# Wait for tag to propagate to GitHub API (fixes race condition after push)
info "Waiting for tag to be available on GitHub..."
for i in {1..10}; do
  if gh api "repos/adrianleb/code-container/git/refs/tags/v$VERSION" &>/dev/null; then
    success "Tag v$VERSION is available"
    break
  fi
  if [[ $i -eq 10 ]]; then
    error "Tag v$VERSION not found on GitHub after 20s. Try running with --skip-tag"
  fi
  warn "Tag not yet available, retrying in 2s... ($i/10)"
  sleep 2
done

RELEASE_NOTES="## What's Changed

### Features
- Full feature parity between local and remote \`ccc\` commands
- Binary auto-download for remote deployments

### Installation

Download the appropriate binary for your platform:

| Platform | Binary |
|----------|--------|
| Linux x64 | \`ccc-linux-x64\` |
| Linux ARM64 | \`ccc-linux-arm64\` |
| macOS x64 | \`ccc-darwin-x64\` |
| macOS ARM64 (Apple Silicon) | \`ccc-darwin-arm64\` |

\`\`\`bash
# Example: Install on Linux x64
curl -fsSL https://github.com/adrianleb/code-container/releases/download/v${VERSION}/ccc-linux-x64 -o ccc
chmod +x ccc
sudo mv ccc /usr/local/bin/
\`\`\`

**Full Changelog**: https://github.com/adrianleb/code-container/compare/v${CURRENT_VERSION}...v${VERSION}"

gh release create "v$VERSION" \
  --title "v$VERSION" \
  --notes "$RELEASE_NOTES" \
  "$BUILD_DIR/ccc-linux-x64" \
  "$BUILD_DIR/ccc-linux-arm64" \
  "$BUILD_DIR/ccc-darwin-x64" \
  "$BUILD_DIR/ccc-darwin-arm64"

echo ""
success "Released v$VERSION!"
echo ""
info "Release URL: https://github.com/adrianleb/code-container/releases/tag/v$VERSION"

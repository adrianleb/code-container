import type { Agent } from "../agents/types.ts";

export interface DockerfileOptions {
  agents: Agent[];
  timezone?: string;
  gitDeltaVersion?: string;
}

export function generateDockerfile(options: DockerfileOptions): string {
  const { agents, timezone = "UTC", gitDeltaVersion = "0.18.2" } = options;

  const agentSnippets = agents
    .map((agent) => agent.getDockerfileSnippet())
    .join("\n\n");

  return `FROM oven/bun:1-debian

ARG TZ=${timezone}

# Install system dependencies including Rust
RUN apt-get update && apt-get install -y --no-install-recommends \\
    git openssh-client sudo zsh fzf gh nano vim less procps unzip gnupg2 \\
    iptables ipset iproute2 dnsutils aggregate jq \\
    ripgrep curl ca-certificates wget \\
    python3 python3-pip python3-venv \\
    build-essential pkg-config libssl-dev \\
    npm \\
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Rename bun user to ccc (bun image already has user with UID 1000)
RUN usermod -l ccc -d /home/ccc -m bun && \\
    groupmod -n ccc bun && \\
    chsh -s /bin/zsh ccc && \\
    echo "ccc ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Setup directories
RUN mkdir -p /workspace /home/ccc/.local/bin /home/ccc/.npm-global /commandhistory && \\
    chown -R ccc:ccc /workspace /home/ccc /commandhistory

# Install git-delta
ARG GIT_DELTA_VERSION=${gitDeltaVersion}
RUN ARCH=$(dpkg --print-architecture) && \\
    wget -q "https://github.com/dandavison/delta/releases/download/\${GIT_DELTA_VERSION}/git-delta_\${GIT_DELTA_VERSION}_\${ARCH}.deb" && \\
    dpkg -i "git-delta_\${GIT_DELTA_VERSION}_\${ARCH}.deb" && \\
    rm "git-delta_\${GIT_DELTA_VERSION}_\${ARCH}.deb"

# Copy firewall script
COPY init-firewall.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/init-firewall.sh && \\
    echo "ccc ALL=(root) NOPASSWD: /usr/local/bin/init-firewall.sh" > /etc/sudoers.d/ccc-firewall && \\
    chmod 0440 /etc/sudoers.d/ccc-firewall

# Switch to user
USER ccc
WORKDIR /workspace

# Environment
ENV SHELL=/bin/zsh
ENV EDITOR=nano
ENV DEVCONTAINER=true
ENV NPM_CONFIG_PREFIX=/home/ccc/.npm-global
ENV PATH="/home/ccc/.npm-global/bin:/home/ccc/.local/bin:/home/ccc/.cargo/bin:$PATH"

# Install Rust and shpool (with BuildKit cache for faster rebuilds)
RUN mkdir -p /home/ccc/.cargo/bin /home/ccc/.cargo/registry /home/ccc/.cargo/git
RUN --mount=type=cache,target=/home/ccc/.cargo/registry,uid=1000,gid=1000 \\
    --mount=type=cache,target=/home/ccc/.cargo/git,uid=1000,gid=1000 \\
    --mount=type=cache,target=/tmp/cargo-target,uid=1000,gid=1000 \\
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && \\
    . "$HOME/.cargo/env" && \\
    CARGO_TARGET_DIR=/tmp/cargo-target cargo install shpool

${agentSnippets}

# Install oh-my-zsh with plugins
RUN sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended && \\
    git clone https://github.com/zsh-users/zsh-autosuggestions \${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions && \\
    git clone https://github.com/zsh-users/zsh-syntax-highlighting \${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting

# Configure zsh
RUN sed -i 's/plugins=(git)/plugins=(git fzf zsh-autosuggestions zsh-syntax-highlighting)/' ~/.zshrc && \\
    echo 'export HISTFILE=/commandhistory/.zsh_history' >> ~/.zshrc && \\
    echo 'export PATH="/home/ccc/.local/bin:/home/ccc/.cargo/bin:$PATH"' >> ~/.zshrc

# Configure shpool
RUN mkdir -p ~/.config/shpool && \\
    printf '[[keybinding]]\\naction = "detach"\\nbinding = "Ctrl-Space Ctrl-q"\\n' > ~/.config/shpool/config.toml

# Install uv (Python package manager) for on-demand tool installation
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

# Copy entrypoint
COPY --chown=ccc:ccc entrypoint.sh /home/ccc/
RUN chmod +x /home/ccc/entrypoint.sh

ENTRYPOINT ["/home/ccc/entrypoint.sh"]
CMD ["zsh"]
`;
}

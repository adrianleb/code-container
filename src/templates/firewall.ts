import type { Agent } from "../agents/types.ts";

export interface FirewallOptions {
  agents: Agent[];
}

export function generateFirewall(options: FirewallOptions): string {
  const { agents } = options;

  const allDomains = new Set<string>();
  for (const agent of agents) {
    for (const domain of agent.firewallDomains) {
      allDomains.add(domain);
    }
  }

  const domainList = Array.from(allDomains).join("\n");

  return `#!/bin/bash
set -e

# Firewall allowlist - domains agents need
ALLOWED_DOMAINS="
${domainList}
"

# Create ipset for allowed IPs
ipset create allowed_ips hash:ip -exist
ipset flush allowed_ips

# Resolve domains and add to ipset
for domain in $ALLOWED_DOMAINS; do
    ips=$(dig +short "$domain" A 2>/dev/null | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$' || true)
    for ip in $ips; do
        ipset add allowed_ips "$ip" -exist 2>/dev/null || true
    done
done

# Setup iptables rules
iptables -F OUTPUT 2>/dev/null || true

# Allow loopback
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established connections
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

# Allow SSH outbound (for git)
iptables -A OUTPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTPS to allowed IPs
iptables -A OUTPUT -p tcp --dport 443 -m set --match-set allowed_ips dst -j ACCEPT

# Allow HTTP to allowed IPs (some registries)
iptables -A OUTPUT -p tcp --dport 80 -m set --match-set allowed_ips dst -j ACCEPT

# Log and drop everything else
iptables -A OUTPUT -j LOG --log-prefix "BLOCKED: " --log-level 4
iptables -A OUTPUT -j DROP

echo "Firewall initialized with allowed domains"
`;
}

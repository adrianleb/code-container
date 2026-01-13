export interface Agent {
  name: string;
  installCmd: string;
  versionCmd: string;
  runCmd: string;
  firewallDomains: string[];
  skipPermissionsFlag?: string;
  configPath?: string;
  getAuthInstructions(): string;
  getDockerfileSnippet(): string;
}

export interface AgentConfig {
  name: string;
  description?: string;
  install_cmd: string;
  run_cmd: string;
  version_cmd: string;
  skip_permissions_flag?: string;
  config_path?: string;

  firewall?: {
    domains: string[];
  };

  auth?: {
    method: "oauth" | "api_key" | "none";
    instructions?: string;
  };

  dockerfile?: {
    snippet?: string;
  };
}

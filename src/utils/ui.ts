export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",

  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",

  bgBlack: "\x1b[40m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
};

export const symbols = {
  check: "✓",
  cross: "✗",
  warning: "⚠",
  info: "ℹ",
  arrow: "→",
  arrowRight: "❯",
  bullet: "•",
  star: "★",
  heart: "♥",
  lightning: "⚡",
  fire: "🔥",
  rocket: "🚀",
  lock: "🔒",
  unlock: "🔓",
  key: "🔑",
  folder: "📁",
  file: "📄",
  gear: "⚙",
  sparkles: "✨",
  package: "📦",
  link: "🔗",
  cloud: "☁",
  server: "🖥",
  container: "📦",
  shield: "🛡",
  terminal: "💻",
};

export const style = {
  error: (text: string) => `${colors.red}${text}${colors.reset}`,
  success: (text: string) => `${colors.green}${text}${colors.reset}`,
  warning: (text: string) => `${colors.yellow}${text}${colors.reset}`,
  info: (text: string) => `${colors.cyan}${text}${colors.reset}`,
  dim: (text: string) => `${colors.dim}${text}${colors.reset}`,
  bold: (text: string) => `${colors.bold}${text}${colors.reset}`,
  highlight: (text: string) => `${colors.bold}${colors.cyan}${text}${colors.reset}`,
  command: (text: string) => `${colors.bold}${colors.yellow}${text}${colors.reset}`,
  path: (text: string) => `${colors.blue}${text}${colors.reset}`,
  code: (text: string) => `${colors.bgBlack}${colors.white} ${text} ${colors.reset}`,

  ok: () => `${colors.green}${symbols.check}${colors.reset}`,
  fail: () => `${colors.red}${symbols.cross}${colors.reset}`,
  warn: () => `${colors.yellow}${symbols.warning}${colors.reset}`,
  infoIcon: () => `${colors.cyan}${symbols.info}${colors.reset}`,
};

export const banner = `
${colors.cyan}${colors.bold}
   ██████╗ ██████╗ ██████╗
  ██╔════╝██╔════╝██╔════╝
  ██║     ██║     ██║
  ██║     ██║     ██║
  ╚██████╗╚██████╗╚██████╗
   ╚═════╝ ╚═════╝ ╚═════╝
${colors.reset}${colors.dim}  Coding Container CLI${colors.reset}
`;

export const bannerSmall = `${colors.cyan}${colors.bold}CCC${colors.reset} ${colors.dim}Coding Container CLI${colors.reset}`;

export function step(current: number, total: number, message: string): string {
  const progress = `${colors.dim}[${current}/${total}]${colors.reset}`;
  return `${progress} ${message}`;
}

export function box(title: string, content: string[]): string {
  const width = Math.max(title.length + 4, ...content.map((l) => l.length + 4));
  const top = `${colors.dim}╭${"─".repeat(width)}╮${colors.reset}`;
  const titleLine = `${colors.dim}│${colors.reset} ${colors.bold}${title}${colors.reset}${" ".repeat(width - title.length - 2)} ${colors.dim}│${colors.reset}`;
  const separator = `${colors.dim}├${"─".repeat(width)}┤${colors.reset}`;
  const contentLines = content.map(
    (line) =>
      `${colors.dim}│${colors.reset} ${line}${" ".repeat(width - line.length - 2)} ${colors.dim}│${colors.reset}`
  );
  const bottom = `${colors.dim}╰${"─".repeat(width)}╯${colors.reset}`;

  return [top, titleLine, separator, ...contentLines, bottom].join("\n");
}

export const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function createSpinner(message: string) {
  let frameIndex = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      process.stdout.write("\x1b[?25l"); // Hide cursor
      intervalId = setInterval(() => {
        const frame = spinnerFrames[frameIndex];
        process.stdout.write(`\r${colors.cyan}${frame}${colors.reset} ${message}`);
        frameIndex = (frameIndex + 1) % spinnerFrames.length;
      }, 80);
    },
    stop(finalMessage?: string) {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      process.stdout.write("\r\x1b[K"); // Clear line
      process.stdout.write("\x1b[?25h"); // Show cursor
      if (finalMessage) {
        console.log(finalMessage);
      }
    },
    succeed(message?: string) {
      this.stop(`${style.ok()} ${message || "Done"}`);
    },
    fail(message?: string) {
      this.stop(`${style.fail()} ${message || "Failed"}`);
    },
  };
}

export function header(text: string): void {
  console.log(`\n${colors.bold}${colors.cyan}${symbols.arrowRight}${colors.reset} ${colors.bold}${text}${colors.reset}`);
}

export function item(text: string, status?: "ok" | "fail" | "warn" | "pending"): void {
  let prefix = "  ";
  switch (status) {
    case "ok":
      prefix = `  ${style.ok()}`;
      break;
    case "fail":
      prefix = `  ${style.fail()}`;
      break;
    case "warn":
      prefix = `  ${style.warn()}`;
      break;
    case "pending":
      prefix = `  ${colors.dim}○${colors.reset}`;
      break;
  }
  console.log(`${prefix} ${text}`);
}

export function hint(text: string): void {
  console.log(`\n${colors.dim}${symbols.info} ${text}${colors.reset}`);
}

export function error(text: string): void {
  console.error(`\n${colors.red}${symbols.cross} Error:${colors.reset} ${text}`);
}

export function success(text: string): void {
  console.log(`\n${colors.green}${symbols.check} ${text}${colors.reset}`);
}

export function warning(text: string): void {
  console.log(`\n${colors.yellow}${symbols.warning} ${text}${colors.reset}`);
}

export function showCommand(cmd: string): void {
  console.log(`\n  ${colors.dim}$${colors.reset} ${colors.bold}${cmd}${colors.reset}`);
}

export function keyValue(key: string, value: string): void {
  console.log(`  ${colors.dim}${key}:${colors.reset} ${value}`);
}

export function divider(): void {
  console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function welcome(): void {
  console.log(banner);
}

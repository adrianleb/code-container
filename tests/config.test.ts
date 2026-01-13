import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { expect, test, mock } from "bun:test";

mock.restore();

const tempHome = mkdtempSync(join(tmpdir(), "ccc-test-"));
mock.module("os", () => ({
  homedir: () => tempHome,
}));

const config = await import(`../src/config.ts?${Date.now()}`);

test("resolveTarget handles local and direct host", () => {
  expect(config.resolveTarget("local")).toBeNull();
  expect(config.resolveTarget("user@example.com")).toBe("user@example.com");
});

test("addRemote and aliases resolve", () => {
  config.addRemote("box", "user@example.com", ["alias"]);
  expect(config.resolveTarget("@box")).toBe("user@example.com");
  expect(config.resolveTarget("@alias")).toBe("user@example.com");
});

test("save/load config persists defaults", () => {
  const cfg = config.loadConfig();
  cfg.default = "@box";
  cfg.default_agent = "claude";
  config.saveConfig(cfg);
  const loaded = config.loadConfig();
  expect(loaded.default).toBe("@box");
  expect(loaded.default_agent).toBe("claude");
});

test("invalid host exits early", () => {
  const originalExit = process.exit;
  let exitCode: number | undefined;
  process.exit = ((code?: number) => {
    exitCode = code;
    throw new Error("exit");
  }) as typeof process.exit;

  try {
    config.resolveTarget("user@bad host");
  } catch (error) {
    expect((error as Error).message).toBe("exit");
  } finally {
    process.exit = originalExit;
  }

  expect(exitCode).toBe(1);
});

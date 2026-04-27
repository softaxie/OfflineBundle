#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  copyDirectory,
  ensureDirectory,
  getResolvedConfig,
} from "./shared.mjs";

const CAPACITOR_CONFIG_CANDIDATES = [
  "capacitor.config.ts",
  "capacitor.config.mjs",
  "capacitor.config.js",
  "capacitor.config.json",
];

// 熱更新包裡的 capacitor.config.json 只保留運行時真正需要的字段，
// 避免把整份項目配置原樣打進 zip。
const pickRuntimeCapacitorConfig = (config, resolvedWebDir) => {
  const runtimeConfig = {
    webDir: config?.webDir || resolvedWebDir,
    bundledWebRuntime: config?.bundledWebRuntime ?? false,
  };

  if (typeof config?.appId === "string" && config.appId.trim()) {
    runtimeConfig.appId = config.appId.trim();
  }
  if (typeof config?.appName === "string" && config.appName.trim()) {
    runtimeConfig.appName = config.appName.trim();
  }
  if (config?.server && typeof config.server === "object") {
    runtimeConfig.server = config.server;
  }
  if (config?.plugins && typeof config.plugins === "object") {
    runtimeConfig.plugins = config.plugins;
  }

  return runtimeConfig;
};

// 項目可能用 ts/js/json 任一格式定義 Capacitor 配置，這裡按常見優先級查找。
const resolveCapacitorConfigPath = (rootDir) =>
  CAPACITOR_CONFIG_CANDIDATES
    .map((fileName) => path.join(rootDir, fileName))
    .find((filePath) => fs.existsSync(filePath));

// 允許直接讀 capacitor.config.ts，這樣插件 CLI 不需要依賴 Android/iOS 產物目錄。
const loadCapacitorConfig = async (rootDir) => {
  const configPath = resolveCapacitorConfigPath(rootDir);
  if (!configPath) return null;

  if (configPath.endsWith(".json")) {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  }

  const imported = await import(pathToFileURL(configPath).href);
  return imported.default ?? imported;
};

// setServerBasePath 指到本地熱更新目錄後，Capacitor 仍然會讀該目錄下的
// capacitor.config.json，所以 zip 內需要生成一份最小可用配置。
const writeRuntimeCapacitorConfig = async (rootDir, stageDir, resolvedWebDir) => {
  const loadedConfig = await loadCapacitorConfig(rootDir);
  const runtimeConfig = pickRuntimeCapacitorConfig(
    loadedConfig,
    path.basename(resolvedWebDir),
  );
  fs.writeFileSync(
    path.join(stageDir, "capacitor.config.json"),
    `${JSON.stringify(runtimeConfig, null, 2)}\n`,
    "utf8",
  );
};

try {
  const { config, rootDir, resolved } = getResolvedConfig(process.argv.slice(2));

  if (!fs.existsSync(resolved.webDir)) {
    throw new Error(`Web build directory not found: ${resolved.webDir}`);
  }

  const stageDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "offline-bundle-package-"),
  );

  try {
    // 先把最終 web 產物複製到臨時目錄，再補充 runtime 配置並整體壓縮。
    copyDirectory(resolved.webDir, stageDir);
    await writeRuntimeCapacitorConfig(rootDir, stageDir, resolved.webDir);

    ensureDirectory(path.dirname(resolved.bundleZipPath));
    fs.rmSync(resolved.bundleZipPath, { force: true });

    const zipResult = spawnSync("zip", ["-r", resolved.bundleZipPath, "."], {
      cwd: stageDir,
      stdio: "inherit",
    });

    if (zipResult.status !== 0) {
      throw new Error(`zip command failed with code ${zipResult.status ?? "unknown"}`);
    }

    console.log(`Offline bundle generated: ${resolved.bundleZipPath}`);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to package offline bundle",
  );
  process.exit(1);
}

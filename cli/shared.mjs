#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG_PATH = "offline-bundle.config.json";
export const DEFAULT_MANIFEST_FILE_NAME = "offline-manifest.json";

// CLI 目前只支持透過 --config 指定項目配置文件。
export const parseCliArgs = (argv) => {
  let configPath = DEFAULT_CONFIG_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config") {
      const nextValue = argv[index + 1];
      if (!nextValue) {
        throw new Error("Missing value for --config");
      }
      configPath = nextValue;
      index += 1;
      continue;
    }

    if (arg.startsWith("--config=")) {
      configPath = arg.slice("--config=".length);
    }
  }

  return { configPath };
};

// 讀取項目級 offline-bundle 配置，並返回配置文件所在目錄，
// 供後續把相對路徑都解析成絕對路徑。
export const loadOfflineBundleConfig = (argv) => {
  const { configPath } = parseCliArgs(argv);
  const absoluteConfigPath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(absoluteConfigPath)) {
    throw new Error(`Offline bundle config not found: ${absoluteConfigPath}`);
  }

  const rootDir = path.dirname(absoluteConfigPath);
  const config = JSON.parse(fs.readFileSync(absoluteConfigPath, "utf8"));
  return {
    config,
    configPath: absoluteConfigPath,
    rootDir,
  };
};

// 熱更新配置裡的路徑都允許寫相對路徑，這裡統一轉成絕對路徑。
export const resolveRequiredPath = (rootDir, value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label} in offline bundle config`);
  }
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
};

// 這些校驗方法用來讓 CLI 在缺配置時儘早失敗，避免後面報錯不清楚。
export const ensureObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Missing ${label} in offline bundle config`);
  }
  return value;
};

export const ensureString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${label} in offline bundle config`);
  }
  return value.trim();
};

export const readJson = (filePath) =>
  JSON.parse(fs.readFileSync(filePath, "utf8"));

export const readText = (filePath) => fs.readFileSync(filePath, "utf8");

// 解析完配置後，產出 CLI 真正要使用的幾個核心路徑：
// web 產物目錄、zip 輸出路徑、上傳 manifest 輸出路徑。
export const getResolvedConfig = (argv) => {
  const loaded = loadOfflineBundleConfig(argv);
  const bundle = ensureObject(loaded.config.bundle, "bundle");

  return {
    ...loaded,
    resolved: {
      webDir: resolveRequiredPath(loaded.rootDir, bundle.webDir, "bundle.webDir"),
      bundleZipPath: resolveRequiredPath(
        loaded.rootDir,
        bundle.zipPath,
        "bundle.zipPath",
      ),
      uploadManifestPath: resolveRequiredPath(
        loaded.rootDir,
        bundle.manifestPath,
        "bundle.manifestPath",
      ),
      manifestFileName: DEFAULT_MANIFEST_FILE_NAME,
    },
  };
};

export const ensureDirectory = (targetPath) => {
  fs.mkdirSync(targetPath, { recursive: true });
};

// copyDirectory 只做最基礎的遞歸複製，供打包時建立臨時目錄使用。
export const copyFile = (sourcePath, targetPath) => {
  ensureDirectory(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
};

export const copyDirectory = (sourceDir, targetDir) => {
  ensureDirectory(targetDir);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      continue;
    }

    copyFile(sourcePath, targetPath);
  }
};

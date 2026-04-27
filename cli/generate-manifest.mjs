#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ensureDirectory,
  ensureString,
  getResolvedConfig,
} from "./shared.mjs";

// 生成 bundle hash 時需要穩定的文件順序，並且排除即將生成的 manifest 自身，
// 否則每次生成都會因為把 manifest 算進去而改變 hash。
const walkFiles = (dir, excludedFileName) => {
  const result = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name === excludedFileName) continue;
    if (entry.isDirectory()) {
      result.push(...walkFiles(fullPath, excludedFileName));
      continue;
    }
    result.push(fullPath);
  }

  return result.sort();
};

// hash 由「相對路徑 + 文件內容」組成，這樣文件改名和內容改動都會反映在結果上。
const createBundleHash = (webDir, excludedFileName) => {
  const hash = crypto.createHash("sha256");

  for (const filePath of walkFiles(webDir, excludedFileName)) {
    hash.update(path.relative(webDir, filePath));
    hash.update("\n");
    hash.update(fs.readFileSync(filePath));
    hash.update("\n");
  }

  return hash.digest("hex");
};

try {
  const { config, resolved } = getResolvedConfig(process.argv.slice(2));

  if (!fs.existsSync(resolved.webDir)) {
    throw new Error(`Web build directory not found: ${resolved.webDir}`);
  }

  const builtAt = new Date().toISOString();
  // bundleVersion 採用時間戳格式，方便比較新舊，且不依賴項目額外維護版本號。
  const bundleVersion = builtAt.replace(/\D/g, "").slice(0, 14);
  const bundleHash = createBundleHash(resolved.webDir, resolved.manifestFileName);
  const manifestUrl = ensureString(config.urls?.manifest, "urls.manifest");
  // bundleUrl 由項目顯式配置，避免不同項目的命名規則不一致時被推導邏輯限制住。
  const bundleUrl = ensureString(config.urls?.bundle, "urls.bundle");

  // 這份 manifest 會同時寫入：
  // 1. webDir/offline-manifest.json，供 App 內置包和本地熱更新包讀取
  // 2. bundle.manifestPath，供上傳到服務端
  const manifest = {
    bundleVersion,
    bundleHash,
    builtAt,
    bundleUrl,
    manifestUrl,
    appVersion: {
      android: {
        minSupportedVersionCode: Number.isFinite(
          config.appVersion?.android?.minSupportedVersionCode,
        )
          ? config.appVersion.android.minSupportedVersionCode
          : 0,
        minSupportedVersionName:
          config.appVersion?.android?.minSupportedVersionName || "",
        message: config.appVersion?.android?.message || "",
        updateUrl: config.appVersion?.android?.updateUrl || "",
      },
      ios: {
        minSupportedBuild: Number.isFinite(config.appVersion?.ios?.minSupportedBuild)
          ? config.appVersion.ios.minSupportedBuild
          : 0,
        minSupportedVersionName:
          config.appVersion?.ios?.minSupportedVersionName || "",
        message: config.appVersion?.ios?.message || "",
        updateUrl: config.appVersion?.ios?.updateUrl || "",
      },
    },
  };

  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestInBundlePath = path.join(
    resolved.webDir,
    resolved.manifestFileName,
  );

  // 兩份 manifest 內容保持一致，避免 builtin/local/remote 比較時來源不一致。
  ensureDirectory(path.dirname(manifestInBundlePath));
  ensureDirectory(path.dirname(resolved.uploadManifestPath));
  fs.writeFileSync(manifestInBundlePath, manifestText);
  fs.writeFileSync(resolved.uploadManifestPath, manifestText);

  console.log(`Offline manifest generated: ${manifestInBundlePath}`);
  console.log(`Upload manifest generated: ${resolved.uploadManifestPath}`);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Failed to generate manifest",
  );
  process.exit(1);
}

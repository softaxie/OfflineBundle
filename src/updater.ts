import { Capacitor, type PluginListenerHandle } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { FileTransfer } from "@capacitor/file-transfer";
import { OfflineBundle, type BundleInfo } from "./index";

const DEFAULT_CHECK_COOLDOWN_MS = 60_000;

export type RemoteManifest = BundleInfo & {
  appVersion?: {
    android?: {
      minSupportedVersionCode?: number | string;
      minSupportedVersionName?: string;
      message?: string;
      updateUrl?: string;
    };
    ios?: {
      minSupportedBuild?: number | string;
      minSupportedVersionName?: string;
      message?: string;
      updateUrl?: string;
    };
  };
};

export type ForceUpdateInfo = {
  currentVersion: string;
  currentBuild: string;
  targetVersion: string;
  message: string;
  updateUrl: string;
  platform: "android" | "ios";
};

/**
 * Web 層熱更新啟動參數。
 *
 * `manifestUrl` 屬於項目級配置；
 * 更新提示和強更提示由 Web 項目自行提供 UI 回調。
 */
export type StartOfflineBundleUpdaterOptions = {
  manifestUrl?: string;
  checkCooldownMs?: number;
  onNeedUpdate: () => Promise<boolean>;
  onForceUpdate: (info: ForceUpdateInfo) => Promise<void>;
};

let resumeListener: PluginListenerHandle | null = null;
let lastCheckAt = 0;
let checking = false;
let prompting = false;

const normalizeToken = (value?: string) => (value || "").trim();

const toBuildNumber = (value?: string | number) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const compareToken = (left?: string, right?: string): number | null => {
  const a = normalizeToken(left);
  const b = normalizeToken(right);
  if (!a && !b) return null;
  if (!a) return -1;
  if (!b) return 1;
  const leftNum = Number.parseInt(a, 10);
  const rightNum = Number.parseInt(b, 10);
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) {
    return leftNum === rightNum ? 0 : leftNum > rightNum ? 1 : -1;
  }
  return a === b ? 0 : a > b ? 1 : -1;
};

const compareBundleInfo = (
  left?: BundleInfo | RemoteManifest | null,
  right?: BundleInfo | RemoteManifest | null,
) => {
  const compareResult =
    compareToken(left?.bundleVersion, right?.bundleVersion) ??
    compareToken(left?.builtAt, right?.builtAt) ??
    compareToken(left?.lastModified, right?.lastModified);
  if (compareResult !== null && compareResult !== 0) {
    return compareResult;
  }

  const leftHash = normalizeToken(left?.bundleHash);
  const rightHash = normalizeToken(right?.bundleHash);
  if (!leftHash && !rightHash) return 0;
  if (!leftHash) return -1;
  if (!rightHash) return 1;
  return leftHash === rightHash ? 0 : leftHash > rightHash ? 1 : -1;
};

const pickNewestBundle = (
  left?: BundleInfo | null,
  right?: BundleInfo | null,
): BundleInfo => {
  if (!left) return right || {};
  if (!right) return left;
  return compareBundleInfo(left, right) >= 0 ? left : right;
};

const getRemoteManifest = async (
  manifestUrl: string,
): Promise<RemoteManifest | null> => {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) return null;
  return (await response.json()) as RemoteManifest;
};

const downloadBundleToPath = async (bundleUrl: string): Promise<string> => {
  const fileName = `offline-update-${Date.now()}.zip`;
  const { path } = await OfflineBundle.getBundleDownloadPath({ fileName });
  await FileTransfer.downloadFile({
    url: bundleUrl,
    path,
    progress: false,
  });
  return path;
};

const getForceUpdateInfo = async (
  remoteManifest: RemoteManifest,
): Promise<ForceUpdateInfo | null> => {
  const platform = Capacitor.getPlatform();
  if (platform !== "android" && platform !== "ios") return null;

  const appInfo = await CapApp.getInfo();
  const currentBuild = normalizeToken(appInfo.build);
  const currentVersion = normalizeToken(appInfo.version);

  if (platform === "android") {
    const platformInfo = remoteManifest.appVersion?.android;
    const minSupported = toBuildNumber(platformInfo?.minSupportedVersionCode);
    if (
      !platformInfo?.updateUrl ||
      toBuildNumber(currentBuild) >= minSupported
    ) {
      return null;
    }
    return {
      currentVersion,
      currentBuild,
      targetVersion:
        normalizeToken(platformInfo.minSupportedVersionName) || String(minSupported),
      message: normalizeToken(platformInfo.message),
      updateUrl: platformInfo.updateUrl,
      platform,
    };
  }

  const platformInfo = remoteManifest.appVersion?.ios;
  const minSupported = toBuildNumber(platformInfo?.minSupportedBuild);
  if (!platformInfo?.updateUrl || toBuildNumber(currentBuild) >= minSupported) {
    return null;
  }
  return {
    currentVersion,
    currentBuild,
    targetVersion:
      normalizeToken(platformInfo.minSupportedVersionName) || String(minSupported),
    message: normalizeToken(platformInfo.message),
    updateUrl: platformInfo.updateUrl,
    platform,
  };
};

const resolveRuntimeUrl = (value?: string) => normalizeToken(value);

async function runCheck(
  options: StartOfflineBundleUpdaterOptions,
  force = false,
) {
  if (!Capacitor.isNativePlatform() || checking) return;

  const now = Date.now();
  const cooldownMs = options.checkCooldownMs ?? DEFAULT_CHECK_COOLDOWN_MS;
  if (!force && now - lastCheckAt < cooldownMs) {
    return;
  }
  lastCheckAt = now;
  checking = true;

  try {
    const manifestUrl =
      resolveRuntimeUrl(options.manifestUrl) ||
      resolveRuntimeUrl(import.meta.env.VITE_OFFLINE_MANIFEST_URL);
    if (!manifestUrl) {
      console.warn("[offline-bundle] missing manifestUrl, skip update check");
      return;
    }

    const remoteManifest = await getRemoteManifest(manifestUrl);
    if (!remoteManifest) return;

    const forceUpdateInfo = await getForceUpdateInfo(remoteManifest);
    if (forceUpdateInfo) {
      if (prompting) return;
      prompting = true;
      await options.onForceUpdate(forceUpdateInfo);
      return;
    }

    const [localInfo, builtinInfo] = await Promise.all([
      OfflineBundle.getLocalBundleInfo(),
      OfflineBundle.getBuiltinBundleInfo(),
    ]);
    const currentBest = pickNewestBundle(localInfo, builtinInfo);
    if (compareBundleInfo(remoteManifest, currentBest) <= 0) return;
    if (prompting) return;

    prompting = true;
    const shouldUpdate = await options.onNeedUpdate();
    if (!shouldUpdate) return;

    const bundleUrl = normalizeToken(remoteManifest.bundleUrl);
    if (!bundleUrl) {
      console.warn(
        "[offline-bundle] manifest missing bundleUrl, skip bundle install",
      );
      return;
    }

    const zipPath = await downloadBundleToPath(bundleUrl);
    const { installed } = await OfflineBundle.installBundle({ zipPath });
    if (!installed) return;

    await OfflineBundle.applyUpdate();
  } catch (error) {
    console.warn("[offline-bundle] update check failed", error);
  } finally {
    checking = false;
    prompting = false;
  }
}

/**
 * 啟動 Web 層熱更新檢查。
 *
 * 這個 helper 只處理通用邏輯：
 * - 拉取遠端 manifest
 * - 比較 remote / builtin / local
 * - 下載 zip 並安裝
 * - 判斷原生 App 是否命中強更
 *
 * 具體 UI 行為由調用方自行通過回調提供。
 */
export async function startOfflineBundleUpdater(
  options: StartOfflineBundleUpdaterOptions,
) {
  if (!Capacitor.isNativePlatform()) {
    return () => Promise.resolve();
  }

  await runCheck(options, true);
  resumeListener = await CapApp.addListener("resume", () => {
    void runCheck(options);
  });

  return async () => {
    if (resumeListener) {
      await resumeListener.remove();
      resumeListener = null;
    }
  };
}

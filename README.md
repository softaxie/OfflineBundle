# @capacitor-offline/offline-bundle

Capacitor 8+ 的離線包更新插件。

- 用它做什麼：App 啟動後檢查遠端 manifest，有新包就下載 zip 並切換。
- 適用場景：前端資源想熱更新，不想每次都重新發原生包。

## 快速上手（給業務項目）

### 1) 安裝

```bash
npm i @capacitor-offline/offline-bundle
# 或
yarn add @capacitor-offline/offline-bundle
```

```bash
npx cap sync
```

### 2) 新建配置文件 `offline-bundle.config.json`

```json
{
  "bundle": {
    "webDir": "dist/app",
    "zipPath": "dist/app.zip",
    "manifestPath": "dist/app-manifest.json"
  },
  "urls": {
    "bundle": "https://example.com/app.zip",
    "manifest": "https://example.com/app-manifest.json"
  }
}
```

### 3) 在 `package.json` 增加腳本

```json
{
  "scripts": {
    "offline-bundle:manifest": "offline-bundle-manifest --config ./offline-bundle.config.json",
    "offline-bundle:package": "offline-bundle-package --config ./offline-bundle.config.json"
  }
}
```

### 4) App 啟動時接入

```ts
import { startOfflineBundleUpdater } from "@capacitor-offline/offline-bundle";

await startOfflineBundleUpdater({
  manifestUrl: import.meta.env.VITE_OFFLINE_MANIFEST_URL,
  onNeedUpdate: async () => true,
  onForceUpdate: async ({ targetVersion, message, updateUrl }) => {
    console.log(targetVersion, message, updateUrl);
  },
});
```

## 命令是做什麼的（重點）

### `offline-bundle:manifest`

```bash
offline-bundle-manifest --config ./offline-bundle.config.json
```

用途：
- 根據 `webDir` 內容生成版本信息（`bundleVersion`、`bundleHash`、`builtAt`）
- 生成離線更新描述文件（manifest）
- 把 `urls.bundle` / `urls.manifest` 寫進 manifest

一句話：先產生「更新說明書」。

### `offline-bundle:package`

```bash
offline-bundle-package --config ./offline-bundle.config.json
```

用途：
- 把 `webDir` 打包成 zip
- 輸出到 `bundle.zipPath`
- 在 zip 裡補運行需要的 `capacitor.config.json`

一句話：再產生「真正要下載安裝的離線包」。

## 日常發版流程（建議）

1. 前端 build 完成（輸出到 `bundle.webDir`）
2. 執行 `offline-bundle:manifest`
3. 執行 `offline-bundle:package`
4. 上傳 `manifest` 和 `zip` 到服務端
5. App 下次啟動/回前台後按 manifest 檢查並更新

## 宿主項目兼容與排錯（Android）

本插件默認「宿主優先」：會優先讀宿主工程的 `rootProject.ext` 版本配置。  
如果宿主編譯報版本相關錯誤，可在宿主 Android 根配置（`android/build.gradle` 或 `variables.gradle`）顯式覆蓋：

```gradle
ext {
  kotlinVersion = '1.9.24'
  androidGradlePluginVersion = '8.2.2'
  compileSdkVersion = 34
  targetSdkVersion = 34
  minSdkVersion = 24
  javaVersion = 17
}
```

常見修復流程：

```bash
cd android && ./gradlew clean
cd ..
npx cap sync android
```

如果是 yarn workspace 項目，建議確保插件安裝在 app 本地 `node_modules`（例如使用 workspace `nohoist`），避免 Capacitor 掃描不到插件。

## 導出

```ts
import {
  OfflineBundle,
  startOfflineBundleUpdater,
} from "@capacitor-offline/offline-bundle";
```

## 方法

### `OfflineBundle.getBuiltinBundleInfo()`
讀取 App 內置離線包信息。

### `OfflineBundle.getLocalBundleInfo()`
讀取本地已安裝熱更新包信息。

### `OfflineBundle.getBundleDownloadPath({ fileName })`
取得本地可寫下載路徑。

參數：
- `fileName`: 下載文件名

### `OfflineBundle.installBundle({ zipPath })`
安裝 zip 到本地離線目錄。

參數：
- `zipPath`: zip 本地路徑

### `OfflineBundle.applyUpdate()`
切換到剛安裝的本地離線包。

## 類型

### `BundleInfo`

```ts
{
  bundleVersion?: string;
  bundleHash?: string;
  builtAt?: string;
  bundleUrl?: string;
  manifestUrl?: string;
  lastModified?: string;
}
```

字段含義：
- `bundleVersion`: 離線包版本
- `bundleHash`: 離線包內容 hash
- `builtAt`: 構建時間
- `bundleUrl`: zip 地址，從 manifest 讀出
- `manifestUrl`: manifest 地址，從 manifest 讀出
- `lastModified`: 本地記錄的最後版本標識

### `startOfflineBundleUpdater(options)`

```ts
type StartOfflineBundleUpdaterOptions = {
  manifestUrl?: string;
  checkCooldownMs?: number;
  onNeedUpdate: () => Promise<boolean>;
  onForceUpdate: (info: ForceUpdateInfo) => Promise<void>;
};
```

字段含義：
- `manifestUrl`: 遠端 manifest 地址；不傳則讀 `VITE_OFFLINE_MANIFEST_URL`
- `checkCooldownMs`: 回前台後再次檢查更新的間隔
- `onNeedUpdate`: 有新 web 包時的回調，返回 `true` 才下載
- `onForceUpdate`: 命中原生強更時的回調

### `ForceUpdateInfo`

```ts
type ForceUpdateInfo = {
  currentVersion: string;
  currentBuild: string;
  targetVersion: string;
  message: string;
  updateUrl: string;
  platform: "android" | "ios";
};
```

字段含義：
- `currentVersion`: 當前 App 版本號
- `currentBuild`: 當前 App build
- `targetVersion`: 需要升級到的展示版本
- `message`: 附加提示文案
- `updateUrl`: 外部更新地址
- `platform`: `android` 或 `ios`

## 配置文件

文件：`offline-bundle.config.json`

```json
{
  "bundle": {
    "webDir": "dist/app",
    "zipPath": "dist/app.zip",
    "manifestPath": "dist/app-manifest.json"
  },
  "urls": {
    "bundle": "https://example.com/app.zip",
    "manifest": "https://example.com/app-manifest.json"
  },
  "appVersion": {
    "android": {
      "minSupportedVersionCode": 2,
      "minSupportedVersionName": "1.0.0",
      "message": "請更新到最新版本。",
      "updateUrl": "https://example.com/android"
    },
    "ios": {
      "minSupportedBuild": 2,
      "minSupportedVersionName": "1.0.0",
      "message": "請前往 TestFlight 安裝最新版本。",
      "updateUrl": "https://testflight.apple.com/"
    }
  }
}
```

### `bundle`
- `webDir`: web build 目錄
- `zipPath`: 離線 zip 輸出路徑
- `manifestPath`: manifest 輸出路徑

### `urls`
- `bundle`: 遠端 zip 地址，會直接寫入 manifest
- `manifest`: 遠端 manifest 地址

### `appVersion.android`
- `minSupportedVersionCode`: Android 最低可用 build
- `minSupportedVersionName`: Android 強更展示版本
- `message`: Android 強更提示文案
- `updateUrl`: Android 外部更新地址

### `appVersion.ios`
- `minSupportedBuild`: iOS 最低可用 build
- `minSupportedVersionName`: iOS 強更展示版本
- `message`: iOS 強更提示文案
- `updateUrl`: iOS 外部更新地址

## CLI

### 生成 manifest

```bash
offline-bundle-manifest --config ./offline-bundle.config.json
```

作用：
- 生成 `{bundle.webDir}/offline-manifest.json`
- 生成 `bundle.manifestPath`
- 把 `urls.bundle` 和 `urls.manifest` 寫入 manifest

### 打包 zip

```bash
offline-bundle-package --config ./offline-bundle.config.json
```

作用：
- 從 `bundle.webDir` 打包 zip
- 輸出到 `bundle.zipPath`
- 自動生成 zip 內的 `capacitor.config.json`

## 怎麼用

### 1. `capacitor.config.*`

保持項目自己的配置，只要確保 `webDir` 和 `bundle.webDir` 一致。

```ts
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.example.app",
  appName: "Example App",
  webDir: "dist/app",
  bundledWebRuntime: false,
};

export default config;
```

### 2. build 命令

```json
{
  "scripts": {
    "offline-bundle:manifest": "offline-bundle-manifest --config ./offline-bundle.config.json",
    "offline-bundle:package": "offline-bundle-package --config ./offline-bundle.config.json",
    "build:cap": "vue-tsc -b && vite build --mode capacitor && yarn run offline-bundle:manifest --config ./offline-bundle.config.json && cap sync",
    "build:offline": "yarn build:cap && yarn run offline-bundle:package --config ./offline-bundle.config.json"
  }
}
```

說明：
- `offline-bundle:manifest`: 項目級別名，執行插件內的 manifest CLI
- `offline-bundle:package`: 項目級別名，執行插件內的 zip CLI
- 這種寫法不依賴 `node_modules/.bin`，`link:` 本地插件和其他項目都能直接用

### 3. App 啟動接入

```ts
import { startOfflineBundleUpdater } from "@capacitor-offline/offline-bundle";

await startOfflineBundleUpdater({
  manifestUrl: import.meta.env.VITE_OFFLINE_MANIFEST_URL,
  onNeedUpdate: async () => {
    return Boolean(
      await dialog.confirm({
        title: "提示",
        message: "發現新版本，是否立即更新？",
        confirmText: "更新",
        cancelText: "稍後",
      }),
    );
  },
  onForceUpdate: async ({ targetVersion, message, updateUrl }) => {
    await dialog.alert({
      title: "版本過低",
      message: [`請更新到 ${targetVersion} 或更高版本。`, message]
        .filter(Boolean)
        .join("\n"),
      confirmText: "立即更新",
      persistent: true,
      keepOpenOnConfirm: true,
      onConfirm: () => openUpdateUrl(updateUrl),
    });
  },
});
```

## manifest 結構

```json
{
  "bundleVersion": "20260319072242",
  "bundleHash": "sha256-hash",
  "builtAt": "2026-03-19T07:22:42.139Z",
  "bundleUrl": "https://example.com/app.zip",
  "manifestUrl": "https://example.com/app-manifest.json",
  "appVersion": {
    "android": {
      "minSupportedVersionCode": 2,
      "minSupportedVersionName": "1.0.0",
      "message": "請更新到最新版本。",
      "updateUrl": "https://example.com/android"
    },
    "ios": {
      "minSupportedBuild": 2,
      "minSupportedVersionName": "1.0.0",
      "message": "請前往 TestFlight 安裝最新版本。",
      "updateUrl": "https://testflight.apple.com/"
    }
  }
}
```

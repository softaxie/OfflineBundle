export interface BundleInfo {
  bundleVersion?: string;
  bundleHash?: string;
  builtAt?: string;
  bundleUrl?: string;
  manifestUrl?: string;
  lastModified?: string;
}

export interface OfflineBundlePlugin {
  getLocalBundleInfo(): Promise<BundleInfo>;
  getBuiltinBundleInfo(): Promise<BundleInfo>;
  getBundleDownloadPath(options: { fileName: string }): Promise<{ path: string }>;
  installBundle(options: { zipPath: string }): Promise<{ installed: boolean }>;
  applyUpdate(): Promise<{ applied: boolean }>;
}

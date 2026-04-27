import Foundation
import Capacitor
import ZIPFoundation

final class OfflineBundleManager {
    struct Config {
        var lastModifiedPreferenceKey: String = "offline_bundle_last_modified"
        var baseDirectoryPath: String = "NoCloud/offline_bundle"
        var bundleDirectoryName: String = "www"
        var temporaryDirectoryName: String = "www_tmp"
        var downloadDirectoryName: String = "offline"
        var downloadFileName: String = "update.zip"
        var metaFileName: String = ".offline_bundle_meta.json"
        var manifestFileName: String = "offline-manifest.json"
        var builtinResourceDirectory: String = "public"
    }

    struct BundleInfo {
        var bundleVersion: String = ""
        var bundleHash: String = ""
        var builtAt: String = ""
        var bundleUrl: String = ""
        var manifestUrl: String = ""
        var lastModified: String = ""

        func isEmpty() -> Bool {
            return bundleVersion.isEmpty &&
                bundleHash.isEmpty &&
                builtAt.isEmpty &&
                bundleUrl.isEmpty &&
                manifestUrl.isEmpty &&
                lastModified.isEmpty
        }

        func toDictionary() -> [String: Any] {
            return [
                "bundleVersion": bundleVersion,
                "bundleHash": bundleHash,
                "builtAt": builtAt,
                "bundleUrl": bundleUrl,
                "manifestUrl": manifestUrl,
                "lastModified": lastModified,
            ]
        }
    }

    private let config: Config
    private weak var viewController: CAPBridgeViewController?
    private let fileManager = FileManager.default
    private var updateReady = false

    init(viewController: CAPBridgeViewController?, config: Config = Config()) {
        self.viewController = viewController
        self.config = config
    }

    func loadLocalIfExists() {
        guard let bundleDir = Self.localBundleURLIfExists(config: config) else {
            NSLog("[OfflineBundle] loadLocalIfExists skip: local bundle missing")
            return
        }
        let localInfo = getLocalBundleInfo()
        let builtinInfo = getBuiltinBundleInfo()
        if !shouldUseLocal(localInfo: localInfo, builtinInfo: builtinInfo) {
            NSLog("[OfflineBundle] loadLocalIfExists clear local bundle because builtin is newer or equal")
            clearLocalBundle()
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.viewController?.setServerBasePath(path: bundleDir.path)
        }
        NSLog("[OfflineBundle] loadLocalIfExists use path=%@", bundleDir.path)
    }

    func getLocalBundleInfo() -> BundleInfo {
        let bundleDir = baseDirectoryURL().appendingPathComponent(config.bundleDirectoryName, isDirectory: true)
        return readBundleInfo(fromDirectory: bundleDir)
    }

    func getBuiltinBundleInfo() -> BundleInfo {
        let manifestURL = builtinManifestURL()
        guard let manifestURL, let data = try? Data(contentsOf: manifestURL) else {
            return BundleInfo()
        }
        return readBundleInfo(fromData: data)
    }

    func getLocalLastModified() -> String {
        let prefValue = (UserDefaults.standard.string(forKey: config.lastModifiedPreferenceKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !prefValue.isEmpty {
            return prefValue
        }

        let fallback = getLocalBundleInfo().lastModified.trimmingCharacters(in: .whitespacesAndNewlines)
        if !fallback.isEmpty {
            UserDefaults.standard.set(fallback, forKey: config.lastModifiedPreferenceKey)
        }
        return fallback
    }

    func getBundleDownloadPath(fileName: String) -> String {
        let safeFileName = fileName.isEmpty ? config.downloadFileName : fileName
        let path = downloadDirectoryURL().appendingPathComponent(safeFileName, isDirectory: false)
        return path.absoluteString
    }

    func installBundle(zipPath: String) -> Bool {
        guard let zipUrl = resolveZipUrl(zipPath), fileManager.fileExists(atPath: zipUrl.path) else { return false }
        do {
            let tmpDir = baseDirectoryURL().appendingPathComponent(config.temporaryDirectoryName, isDirectory: true)
            deleteIfExists(tmpDir)
            try ensureDir(tmpDir)
            if !unzip(zipUrl, to: tmpDir) {
                return false
            }
            let installedInfo = readBundleInfo(fromDirectory: tmpDir)
            writeMeta(in: tmpDir, info: installedInfo)

            let bundleDir = baseDirectoryURL().appendingPathComponent(config.bundleDirectoryName, isDirectory: true)
            deleteIfExists(bundleDir)
            try fileManager.moveItem(at: tmpDir, to: bundleDir)

            UserDefaults.standard.set(installedInfo.lastModified, forKey: config.lastModifiedPreferenceKey)
            updateReady = true
            return true
        } catch {
            return false
        }
    }

    func applyUpdateIfReady() -> Bool {
        guard updateReady else { return false }
        updateReady = false
        return applyUpdateNow()
    }

    private func applyUpdateNow() -> Bool {
        guard let bundleDir = Self.localBundleURLIfExists(config: config) else { return false }
        DispatchQueue.main.async { [weak self] in
            self?.viewController?.setServerBasePath(path: bundleDir.path)
        }
        return true
    }

    private func baseDirectoryURL() -> URL {
        let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first!
        let trimmedPath = config.baseDirectoryPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty else {
            return library
        }

        return trimmedPath
            .split(separator: "/")
            .reduce(library) { partialResult, component in
                partialResult.appendingPathComponent(String(component), isDirectory: true)
            }
    }

    private func downloadDirectoryURL() -> URL {
        baseDirectoryURL().appendingPathComponent(config.downloadDirectoryName, isDirectory: true)
    }

    private func builtinManifestURL() -> URL? {
        let manifestUrl = URL(fileURLWithPath: config.manifestFileName)
        let resourceName = manifestUrl.deletingPathExtension().lastPathComponent
        let resourceExtension = manifestUrl.pathExtension.isEmpty ? nil : manifestUrl.pathExtension
        let subdirectory = config.builtinResourceDirectory.trimmingCharacters(in: .whitespacesAndNewlines)
        return Bundle.main.url(
            forResource: resourceName,
            withExtension: resourceExtension,
            subdirectory: subdirectory.isEmpty ? nil : subdirectory
        )
    }

    private func resolveZipUrl(_ zipPath: String) -> URL? {
        if zipPath.hasPrefix("file://") {
            return URL(string: zipPath)
        }
        return URL(fileURLWithPath: zipPath)
    }

    private func writeMeta(in dir: URL, info: BundleInfo) {
        let meta = dir.appendingPathComponent(config.metaFileName, isDirectory: false)
        let body: [String: String] = [
            "bundleVersion": info.bundleVersion,
            "bundleHash": info.bundleHash,
            "builtAt": info.builtAt,
            "bundleUrl": info.bundleUrl,
            "manifestUrl": info.manifestUrl,
            "lastModified": info.lastModified,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        try? data.write(to: meta, options: .atomic)
    }

    private func readBundleInfo(fromDirectory dir: URL) -> BundleInfo {
        let manifest = dir.appendingPathComponent(config.manifestFileName, isDirectory: false)
        if fileManager.fileExists(atPath: manifest.path),
           let data = try? Data(contentsOf: manifest) {
            return readBundleInfo(fromData: data)
        }

        let meta = dir.appendingPathComponent(config.metaFileName, isDirectory: false)
        guard fileManager.fileExists(atPath: meta.path),
              let data = try? Data(contentsOf: meta) else {
            return BundleInfo()
        }
        return readBundleInfo(fromData: data)
    }

    private func readBundleInfo(fromData data: Data) -> BundleInfo {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return BundleInfo()
        }
        let prefLastModified = (UserDefaults.standard.string(forKey: config.lastModifiedPreferenceKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let builtAt = (obj["builtAt"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return BundleInfo(
            bundleVersion: (obj["bundleVersion"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            bundleHash: (obj["bundleHash"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            builtAt: builtAt,
            bundleUrl: (obj["bundleUrl"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            manifestUrl: (obj["manifestUrl"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            lastModified: ((obj["lastModified"] as? String) ?? (builtAt.isEmpty ? prefLastModified : builtAt))
                .trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    private func shouldUseLocal(localInfo: BundleInfo, builtinInfo: BundleInfo) -> Bool {
        if localInfo.isEmpty() {
            return false
        }
        if builtinInfo.isEmpty() {
            return true
        }
        return compareBundleInfo(localInfo, builtinInfo) > 0
    }

    private func compareBundleInfo(_ left: BundleInfo, _ right: BundleInfo) -> Int {
        if let compared = compareVersionToken(left.bundleVersion, right.bundleVersion) {
            return compared
        }
        if let compared = compareVersionToken(left.builtAt, right.builtAt) {
            return compared
        }
        if let compared = compareVersionToken(left.lastModified, right.lastModified) {
            return compared
        }
        if left.bundleHash == right.bundleHash {
            return 0
        }
        return left.bundleHash > right.bundleHash ? 1 : -1
    }

    private func compareVersionToken(_ left: String, _ right: String) -> Int? {
        let a = left.trimmingCharacters(in: .whitespacesAndNewlines)
        let b = right.trimmingCharacters(in: .whitespacesAndNewlines)
        if a.isEmpty && b.isEmpty {
            return nil
        }
        if a.isEmpty {
            return -1
        }
        if b.isEmpty {
            return 1
        }
        if let leftInt = Int64(a), let rightInt = Int64(b) {
            if leftInt == rightInt { return 0 }
            return leftInt > rightInt ? 1 : -1
        }
        if a == b {
            return 0
        }
        return a > b ? 1 : -1
    }

    private func clearLocalBundle() {
        let bundleDir = baseDirectoryURL().appendingPathComponent(config.bundleDirectoryName, isDirectory: true)
        deleteIfExists(bundleDir)
        UserDefaults.standard.removeObject(forKey: config.lastModifiedPreferenceKey)
    }

    private func unzip(_ zipUrl: URL, to targetDir: URL) -> Bool {
        guard let archive = Archive(url: zipUrl, accessMode: .read) else { return false }
        do {
            for entry in archive {
                let destinationUrl = targetDir.appendingPathComponent(entry.path)
                if entry.type == .directory {
                    try ensureDir(destinationUrl)
                    continue
                }
                let parent = destinationUrl.deletingLastPathComponent()
                try ensureDir(parent)
                _ = try archive.extract(entry, to: destinationUrl)
            }
            return true
        } catch {
            return false
        }
    }

    private func ensureDir(_ url: URL) throws {
        if fileManager.fileExists(atPath: url.path) { return }
        try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
    }

    private func deleteIfExists(_ url: URL) {
        guard fileManager.fileExists(atPath: url.path) else { return }
        try? fileManager.removeItem(at: url)
    }

    static func localBundleURLIfExists(config: Config = Config()) -> URL? {
        let fileManager = FileManager.default
        let manager = OfflineBundleManager(viewController: nil, config: config)
        let bundleDir = manager.baseDirectoryURL()
            .appendingPathComponent(config.bundleDirectoryName, isDirectory: true)
        let indexUrl = bundleDir.appendingPathComponent("index.html")
        return fileManager.fileExists(atPath: indexUrl.path) ? bundleDir : nil
    }
}

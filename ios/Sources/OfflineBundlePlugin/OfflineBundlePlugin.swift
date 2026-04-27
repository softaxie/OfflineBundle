import Capacitor

@objc(OfflineBundlePlugin)
public class OfflineBundlePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OfflineBundlePlugin"
    public let jsName = "OfflineBundle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLocalBundleInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBuiltinBundleInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBundleDownloadPath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "installBundle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "applyUpdate", returnType: CAPPluginReturnPromise)
    ]

    private var manager: OfflineBundleManager?

    public override func load() {
        manager = OfflineBundleManager(
            viewController: bridge?.viewController as? CAPBridgeViewController
        )
        manager?.loadLocalIfExists()
        NSLog("[OfflineBundlePlugin] load completed")
    }

    @objc func getLocalBundleInfo(_ call: CAPPluginCall) {
        call.resolve(manager?.getLocalBundleInfo().toDictionary() ?? [:])
    }

    @objc func getBuiltinBundleInfo(_ call: CAPPluginCall) {
        call.resolve(manager?.getBuiltinBundleInfo().toDictionary() ?? [:])
    }

    @objc func getBundleDownloadPath(_ call: CAPPluginCall) {
        let fileName = call.getString("fileName") ?? ""
        let path = manager?.getBundleDownloadPath(fileName: fileName) ?? ""
        call.resolve(["path": path])
    }

    @objc func installBundle(_ call: CAPPluginCall) {
        let zipPath = call.getString("zipPath") ?? ""
        let installed = manager?.installBundle(zipPath: zipPath) ?? false
        call.resolve(["installed": installed])
    }

    @objc func applyUpdate(_ call: CAPPluginCall) {
        let applied = manager?.applyUpdateIfReady() ?? false
        call.resolve(["applied": applied])
    }
}

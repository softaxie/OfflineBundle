package com.oj.plugins.offlinebundle

import android.util.Log
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "OfflineBundle")
class OfflineBundlePlugin : Plugin() {
    private val tag = "OfflineBundlePlugin"
    private var manager: OfflineBundleManager? = null

    override fun load() {
        try {
            Log.i(tag, "load() invoked")
            manager = OfflineBundleManager(
                context = context,
                bridge = bridge,
            )
            runCatching { manager?.loadLocalIfExists() }
                .onFailure { error ->
                    Log.e(tag, "loadLocalIfExists() failed during plugin load", error)
                }
            Log.i(tag, "load() completed")
        } catch (error: Throwable) {
            Log.e(tag, "load() fatal error", error)
            manager = OfflineBundleManager(
                context = context,
                bridge = bridge,
            )
        }
    }

    @PluginMethod
    fun getLocalBundleInfo(call: PluginCall) {
        call.resolve(manager?.getLocalBundleInfo()?.toJsObject() ?: JSObject())
    }

    @PluginMethod
    fun getBuiltinBundleInfo(call: PluginCall) {
        call.resolve(manager?.getBuiltinBundleInfo()?.toJsObject() ?: JSObject())
    }

    @PluginMethod
    fun getBundleDownloadPath(call: PluginCall) {
        val fileName = call.getString("fileName").orEmpty()
        val path = manager?.getBundleDownloadPath(fileName).orEmpty()
        call.resolve(JSObject().put("path", path))
    }

    @PluginMethod
    fun installBundle(call: PluginCall) {
        val zipPath = call.getString("zipPath").orEmpty()
        val installed = manager?.installBundle(zipPath) ?: false
        call.resolve(JSObject().put("installed", installed))
    }

    @PluginMethod
    fun applyUpdate(call: PluginCall) {
        val applied = manager?.applyUpdateIfReady() ?: false
        call.resolve(JSObject().put("applied", applied))
    }
}

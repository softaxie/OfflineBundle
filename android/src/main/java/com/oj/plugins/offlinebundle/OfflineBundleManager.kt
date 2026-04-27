package com.oj.plugins.offlinebundle

import android.content.Context
import android.net.Uri
import android.util.Log
import com.getcapacitor.Bridge
import com.getcapacitor.JSObject
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.URI
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream

class OfflineBundleManager(
    private val context: Context,
    private val bridge: Bridge?,
    private val config: Config = Config(),
) {

    data class Config(
        var preferencesName: String = "offline_bundle",
        var lastModifiedPreferenceKey: String = "offline_bundle_last_modified",
        var baseDirectoryName: String = "offline_bundle",
        var bundleDirectoryName: String = "www",
        var temporaryDirectoryName: String = "www_tmp",
        var downloadDirectoryName: String = "offline",
        var downloadFileName: String = "update.zip",
        var metaFileName: String = ".offline_bundle_meta.json",
        var manifestFileName: String = "offline-manifest.json",
        var builtinAssetPath: String = "public/offline-manifest.json",
    )

    data class BundleInfo(
        val bundleVersion: String = "",
        val bundleHash: String = "",
        val builtAt: String = "",
        val bundleUrl: String = "",
        val manifestUrl: String = "",
        val lastModified: String = "",
    ) {
        fun toJsObject(): JSObject {
            return JSObject()
                .put("bundleVersion", bundleVersion)
                .put("bundleHash", bundleHash)
                .put("builtAt", builtAt)
                .put("bundleUrl", bundleUrl)
                .put("manifestUrl", manifestUrl)
                .put("lastModified", lastModified)
        }

        fun isEmpty(): Boolean {
            return bundleVersion.isBlank() &&
                bundleHash.isBlank() &&
                builtAt.isBlank() &&
                bundleUrl.isBlank() &&
                manifestUrl.isBlank() &&
                lastModified.isBlank()
        }
    }

    @Volatile private var updateReady = false
    private val prefs by lazy {
        context.getSharedPreferences(config.preferencesName, Context.MODE_PRIVATE)
    }

    fun loadLocalIfExists() {
        runCatching {
            val bundleDir = bundleDirectory()
            val indexFile = File(bundleDir, "index.html")
            if (!indexFile.exists()) {
                Log.i(TAG, "loadLocalIfExists() skip: index missing at ${indexFile.absolutePath}")
                return
            }

            val localInfo = readLocalBundleInfo()
            val builtinInfo = readBuiltinBundleInfo()
            if (!shouldUseLocal(localInfo, builtinInfo)) {
                Log.i(TAG, "loadLocalIfExists() local bundle is not newer than builtin, clearing local bundle")
                clearLocalBundle()
                return
            }

            bridge?.setServerBasePath(bundleDir.absolutePath)
            Log.i(TAG, "loadLocalIfExists() using local bundle path=${bundleDir.absolutePath}")
        }.onFailure { error ->
            Log.e(TAG, "loadLocalIfExists() error", error)
        }
    }

    @Synchronized
    fun getLocalBundleInfo(): BundleInfo {
        return readLocalBundleInfo()
    }

    @Synchronized
    fun getBuiltinBundleInfo(): BundleInfo {
        return readBuiltinBundleInfo()
    }

    @Synchronized
    fun getLocalLastModified(): String {
        val prefValue = prefs.getString(config.lastModifiedPreferenceKey, "").orEmpty().trim()
        if (prefValue.isNotEmpty()) return prefValue

        val fallback = readLocalBundleInfo().lastModified.trim()
        if (fallback.isNotEmpty()) {
            prefs.edit().putString(config.lastModifiedPreferenceKey, fallback).commit()
        }
        return fallback
    }

    @Synchronized
    fun getBundleDownloadPath(fileName: String): String {
        val safeFileName = if (fileName.isBlank()) config.downloadFileName else fileName
        val downloadDir = downloadDirectory().apply {
            if (!exists()) mkdirs()
        }
        return Uri.fromFile(File(downloadDir, safeFileName)).toString()
    }

    @Synchronized
    fun installBundle(zipPath: String): Boolean {
        if (zipPath.isBlank()) return false
        return runCatching {
            val zipFile = resolveZipFile(zipPath)
            if (!zipFile.exists()) return false

            val tmpDir = temporaryDirectory().also { deleteRecursively(it) }
            if (!tmpDir.mkdirs()) return false
            if (!unzip(zipFile, tmpDir)) return false

            val installedInfo = readBundleInfoFromDir(tmpDir)
            writeMeta(tmpDir, installedInfo)

            val bundleDir = bundleDirectory()
            deleteRecursively(bundleDir)
            if (!tmpDir.renameTo(bundleDir)) return false

            prefs.edit().putString(config.lastModifiedPreferenceKey, installedInfo.lastModified).commit()
            updateReady = true
            true
        }.onFailure { error ->
            Log.e(TAG, "installBundle() failed", error)
        }.getOrDefault(false)
    }

    @Synchronized
    fun applyUpdateIfReady(): Boolean {
        if (!updateReady) return false
        updateReady = false
        return applyUpdateNow()
    }

    private fun applyUpdateNow(): Boolean {
        val bundleDir = bundleDirectory()
        val indexFile = File(bundleDir, "index.html")
        if (!indexFile.exists()) return false
        bridge?.activity?.runOnUiThread {
            bridge.setServerBasePath(bundleDir.absolutePath)
            bridge.reload()
        }
        return true
    }

    private fun baseDirectory(): File {
        return File(context.filesDir, config.baseDirectoryName).apply {
            if (!exists()) mkdirs()
        }
    }

    private fun bundleDirectory(): File {
        return File(baseDirectory(), config.bundleDirectoryName)
    }

    private fun temporaryDirectory(): File {
        return File(baseDirectory(), config.temporaryDirectoryName)
    }

    private fun downloadDirectory(): File {
        return File(baseDirectory(), config.downloadDirectoryName)
    }

    private fun resolveZipFile(zipPath: String): File {
        return try {
            if (zipPath.startsWith("file://")) File(URI(zipPath)) else File(zipPath)
        } catch (_: Exception) {
            File(zipPath)
        }
    }

    private fun unzip(zipFile: File, targetDir: File): Boolean {
        return try {
            FileInputStream(zipFile).use { fis ->
                ZipInputStream(BufferedInputStream(fis)).use { zis ->
                    var entry: ZipEntry?
                    val buffer = ByteArray(8 * 1024)
                    while (zis.nextEntry.also { entry = it } != null) {
                        val zipEntry = entry ?: continue
                        val outFile = File(targetDir, zipEntry.name)
                        if (zipEntry.isDirectory) {
                            if (!outFile.exists() && !outFile.mkdirs()) return false
                            continue
                        }
                        val parent = outFile.parentFile
                        if (parent != null && !parent.exists() && !parent.mkdirs()) return false
                        FileOutputStream(outFile).use { fos ->
                            var count: Int
                            while (zis.read(buffer).also { count = it } != -1) {
                                fos.write(buffer, 0, count)
                            }
                        }
                        zis.closeEntry()
                    }
                }
            }
            true
        } catch (error: Exception) {
            Log.e(TAG, "unzip() error", error)
            false
        }
    }

    private fun writeMeta(dir: File, info: BundleInfo) {
        runCatching {
            val metaFile = File(dir, config.metaFileName)
            val body = JSONObject()
                .put("bundleVersion", info.bundleVersion)
                .put("bundleHash", info.bundleHash)
                .put("builtAt", info.builtAt)
                .put("bundleUrl", info.bundleUrl)
                .put("manifestUrl", info.manifestUrl)
                .put("lastModified", info.lastModified)
                .toString()
            metaFile.writeText(body)
        }
    }

    private fun readLocalBundleInfo(): BundleInfo {
        return readBundleInfoFromDir(bundleDirectory())
    }

    private fun readBuiltinBundleInfo(): BundleInfo {
        return runCatching {
            context.assets.open(config.builtinAssetPath).use { input ->
                val body = input.bufferedReader().use { it.readText() }
                readBundleInfoFromJson(body)
            }
        }.getOrElse {
            Log.i(TAG, "readBuiltinBundleInfo() manifest missing or invalid")
            BundleInfo()
        }
    }

    private fun readBundleInfoFromDir(dir: File): BundleInfo {
        if (!dir.exists()) return BundleInfo()
        val manifestFile = File(dir, config.manifestFileName)
        if (manifestFile.exists()) {
            return runCatching {
                readBundleInfoFromJson(manifestFile.readText())
            }.getOrElse {
                Log.w(TAG, "readBundleInfoFromDir() manifest parse failed", it)
                BundleInfo()
            }
        }

        val metaFile = File(dir, config.metaFileName)
        if (!metaFile.exists()) return BundleInfo()
        return runCatching {
            readBundleInfoFromJson(metaFile.readText())
        }.getOrDefault(BundleInfo())
    }

    private fun readBundleInfoFromJson(body: String): BundleInfo {
        val json = JSONObject(body)
        val prefLastModified = prefs.getString(config.lastModifiedPreferenceKey, "").orEmpty().trim()
        val builtAt = json.optString("builtAt", "").trim()
        return BundleInfo(
            bundleVersion = json.optString("bundleVersion", "").trim(),
            bundleHash = json.optString("bundleHash", "").trim(),
            builtAt = builtAt,
            bundleUrl = json.optString("bundleUrl", "").trim(),
            manifestUrl = json.optString("manifestUrl", "").trim(),
            lastModified = json.optString("lastModified", builtAt.ifBlank { prefLastModified }).trim(),
        )
    }

    private fun shouldUseLocal(localInfo: BundleInfo, builtinInfo: BundleInfo): Boolean {
        if (localInfo.isEmpty()) return false
        if (builtinInfo.isEmpty()) return true
        return compareBundleInfo(localInfo, builtinInfo) > 0
    }

    private fun compareBundleInfo(left: BundleInfo, right: BundleInfo): Int {
        compareVersionToken(left.bundleVersion, right.bundleVersion)?.let { return it }
        compareVersionToken(left.builtAt, right.builtAt)?.let { return it }
        compareVersionToken(left.lastModified, right.lastModified)?.let { return it }
        return left.bundleHash.compareTo(right.bundleHash)
    }

    private fun compareVersionToken(left: String, right: String): Int? {
        val a = left.trim()
        val b = right.trim()
        if (a.isEmpty() && b.isEmpty()) return null
        if (a.isEmpty()) return -1
        if (b.isEmpty()) return 1
        val leftLong = a.toLongOrNull()
        val rightLong = b.toLongOrNull()
        if (leftLong != null && rightLong != null) {
            return leftLong.compareTo(rightLong)
        }
        return a.compareTo(b)
    }

    private fun clearLocalBundle() {
        deleteRecursively(bundleDirectory())
        prefs.edit().remove(config.lastModifiedPreferenceKey).commit()
    }

    private fun deleteRecursively(file: File?) {
        if (file == null || !file.exists()) return
        if (file.isDirectory) {
            file.listFiles()?.forEach { child -> deleteRecursively(child) }
        }
        file.delete()
    }

    companion object {
        private const val TAG = "OfflineBundle"
    }
}

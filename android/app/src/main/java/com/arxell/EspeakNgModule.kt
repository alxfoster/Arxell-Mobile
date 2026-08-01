package com.arxell

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.arxell.specs.NativeEspeakNgSpec
import java.io.File

/**
 * eSpeak-ng TurboModule — on-device phonemization for the Inflect TTS engine.
 *
 * Lifecycle: the first `phonemize` call lazily extracts the bundled
 * espeak-ng-data files (en-only minimal set, ~900 KB) from assets into the
 * app's files dir, then calls `nativeInit` to point eSpeak-ng at that path
 * and select the en-us voice. Subsequent calls go straight to `nativePhonemize`.
 *
 * The native side lives in jni/src/espeak_ng.cpp and is linked into
 * libappmodules.so alongside the vendored eSpeak-ng static library.
 */
@ReactModule(name = NativeEspeakNgSpec.NAME)
class EspeakNgModule(reactContext: ReactApplicationContext) :
    NativeEspeakNgSpec(reactContext) {

  private external fun nativeInit(dataPath: String): Boolean
  private external fun nativePhonemize(text: String): String

  override fun getName(): String = NativeEspeakNgSpec.NAME

  // Lazily computed; if false, the JS side falls back to the JS phonemizer.
  @Volatile private var initialized = false

  // Minimal en-only data set. en-us phonemization needs the phoneme tables
  // (phondata/phontab/phonindex), intonations, and the en dictionary. The
  // en-us voice auto-derives from en_dict in eSpeak-ng 1.53 (no voice file).
  private val dataFiles = listOf("phondata", "phonindex", "phontab", "intonations", "en_dict")

  /**
   * Extract the espeak-ng-data asset files into filesDir/espeak-ng-data/ (once).
   * Returns filesDir.absolutePath — the parent eSpeak-ng expects (it looks
   * for `<path>/espeak-ng-data/`).
   */
  private fun ensureDataExtracted(): String {
    val dataDir = File(reactApplicationContext.filesDir, "espeak-ng-data")
    val marker = File(dataDir, ".v1")
    if (marker.exists()) {
      return reactApplicationContext.filesDir.absolutePath
    }
    dataDir.mkdirs()
    for (name in dataFiles) {
      val target = File(dataDir, name)
      if (target.exists()) {
        continue
      }
      reactApplicationContext.assets.open("espeak-ng-data/$name").use { input ->
        target.outputStream().use { output -> input.copyTo(output) }
      }
    }
    marker.createNewFile()
    return reactApplicationContext.filesDir.absolutePath
  }

  private fun ensureInitialized(): Boolean {
    if (initialized) {
      return true
    }
    return try {
      val dataPath = ensureDataExtracted()
      val ok = nativeInit(dataPath)
      initialized = ok
      ok
    } catch (e: Throwable) {
      // Asset extraction or native init failure — JS side will fall back.
      initialized = false
      false
    }
  }

  override fun phonemize(text: String, promise: Promise) {
    try {
      if (!ensureInitialized()) {
        // Resolve empty so the JS caller can detect "unavailable" and fall
        // back without a rejection propagating through the TTS pipeline.
        promise.resolve("")
        return
      }
      promise.resolve(nativePhonemize(text))
    } catch (e: Throwable) {
      promise.reject("ESPEAK_PHONEMIZE", e.message ?: "unknown error")
    }
  }
}

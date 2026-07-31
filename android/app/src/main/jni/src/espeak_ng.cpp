// eSpeak-ng JNI shim for on-device phonemization.
//
// Exposes the two calls the Inflect engine needs:
//   - nativeInit(dataPath): initialize eSpeak-ng, point it at the extracted
//     espeak-ng-data/ directory, and select the en-us voice.
//   - nativePhonemize(text): text → IPA (with stress, punctuation preserved)
//     using espeak_TextToPhonemes in IPA mode (0x02). This matches the
//     reference Python phonemizer (espeak backend, en-us, with_stress,
//     preserve_punctuation) the Inflect-Nano-v2 model was trained on.
//
// Linked into libappmodules.so (no separate System.loadLibrary) — same
// pattern as hardware_info.cpp. The eSpeak-ng static lib is pulled in via
// the app CMakeLists (add_subdirectory on the vendored source).

#include <android/log.h>
#include <jni.h>
#include <string>

#include <espeak-ng/speak_lib.h>

#define ESPEAK_LOG_TAG "PocketPalEspeakNg"
#define ESPEAK_LOGI(...) __android_log_print(ANDROID_LOG_INFO, ESPEAK_LOG_TAG, __VA_ARGS__)
#define ESPEAK_LOGE(...) __android_log_print(ANDROID_LOG_ERROR, ESPEAK_LOG_TAG, __VA_ARGS__)

// IPA output only (no tie, no trace). Stress markers (ˈˌ) are part of IPA.
// Ties (U+0361) are intentionally off — they'd be dropped by Inflect's
// symbol table anyway, so omitting them yields a cleaner token stream.
static constexpr int kPhonemeModeIpa = 2; // espeakPHONEMES_IPA

static bool g_initialized = false;

extern "C" JNIEXPORT jboolean JNICALL
Java_com_pocketpalai_EspeakNgModule_nativeInit(JNIEnv* env, jobject /* thiz */, jstring jDataPath) {
    const char* dataPath = env->GetStringUTFChars(jDataPath, nullptr);
    // `path` is the directory that CONTAINS espeak-ng-data/.
    int sampleRate = espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, dataPath, 0);
    if (sampleRate == -1) {
        ESPEAK_LOGE("espeak_Initialize failed (dataPath=%s)", dataPath);
        env->ReleaseStringUTFChars(jDataPath, dataPath);
        return JNI_FALSE;
    }
    env->ReleaseStringUTFChars(jDataPath, dataPath);

    espeak_ERROR err = espeak_SetVoiceByName("en-us");
    if (err != EE_OK) {
        // en-us voice auto-derives from en_dict in eSpeak-ng 1.53; a failure
        // here is fatal for Inflect (English-only model).
        ESPEAK_LOGE("espeak_SetVoiceByName(\"en-us\") failed: %d", static_cast<int>(err));
        return JNI_FALSE;
    }

    g_initialized = true;
    ESPEAK_LOGI("initialized (sampleRate=%d, voice=en-us)", sampleRate);
    return JNI_TRUE;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_pocketpalai_EspeakNgModule_nativePhonemize(JNIEnv* env, jobject /* thiz */, jstring jText) {
    if (!g_initialized) {
        return env->NewStringUTF("");
    }

    const char* utf8 = env->GetStringUTFChars(jText, nullptr);
    if (utf8 == nullptr) {
        return env->NewStringUTF("");
    }

    const void* textPtr = utf8;
    std::string out;
    // espeak_TextToPhonemes processes one clause (sentence) per call and
    // advances textPtr past it. Loop until the whole input is consumed.
    while (true) {
        const char* phonemes = espeak_TextToPhonemes(
            &textPtr, espeakCHARS_UTF8, kPhonemeModeIpa);
        if (phonemes != nullptr && phonemes[0] != '\0') {
            if (!out.empty()) {
                out.push_back(' ');
            }
            out.append(phonemes);
        }
        const char* cursor = static_cast<const char*>(textPtr);
        if (cursor == nullptr || cursor[0] == '\0') {
            break;
        }
    }

    env->ReleaseStringUTFChars(jText, utf8);
    return env->NewStringUTF(out.c_str());
}

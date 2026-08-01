<div align="center">

<img src="src/assets/arxell-dark-v2.png" alt="Arxell logo" width="120" />

# Arxell

**A private AI assistant that runs entirely on your phone — and listens when you talk to it.**

Chat with language models, give them a voice, talk back to them, and let them use tools — all on-device. No account, no cloud, no internet required.

> **Fork notice:** Arxell is a fork of [PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai) by [Amin Ghorbani](https://github.com/a-ghorbani) and its wonderful community of contributors. We are deeply grateful to the PocketPal team for building a principled, genuinely on-device AI assistant and for releasing it under the MIT license so projects like this one can exist. **Thank you.** 🙏 See [Acknowledgements](#acknowledgements) and [Why this fork exists](#why-this-fork-exists) below.

<br/>

[![License: MIT](https://img.shields.io/github/license/a-ghorbani/pocketpal-ai)](LICENSE)
[![Upstream](https://img.shields.io/badge/upstream-PocketPal%20AI-0D96F6)](https://github.com/a-ghorbani/pocketpal-ai)

</div>

---

## Why this fork exists

PocketPal AI is an exceptional foundation: a fast, private, on-device LLM runner with a clean agent/tool-use architecture and great TTS. Arxell builds on that foundation with a single guiding goal — **make the assistant voice-first** — while staying 100% on-device and offline.

Concretely, Arxell adds (and continues to develop):

- **🎤 On-device Speech-to-Text (voice input)** via [Moonshine](https://github.com/UsefulSensors/moonshine) (Useful Sensors), integrated through [`@siteed/moonshine.rn`](https://github.com/deeeed/audiolab). Tap the mic, speak, and your words stream into the chat — transcribed locally, never sent to a server.
- **🔊 Voice-gated capture** with a bundled [Silero VAD](https://github.com/snakers4/silero-vad) so the recognizer only fires on actual speech (no silence hallucination, precise end-of-speech endpointing).
- **🧭 A unified voice + brains setup** in onboarding: the first-run flow detects your LLM, voice-input (Moonshine), and voice-output (Kokoro TTS) models and offers one-tap installs for each.
- **🎯 Small-model focus** — we default to Moonshine **tiny-streaming** (~52 MB) for responsive incremental voice input, and treat the VAD as bundled infrastructure rather than another thing the user must fetch.

Everything else — the offline LLM engine, agents, tool use, TTS, hardware acceleration — is inherited from PocketPal AI. We aim to stay close to upstream and contribute back where it makes sense.

> Have a different reason to fork PocketPal? The upstream project is actively maintained and welcoming to contributors — consider contributing there first. Arxell exists specifically to push the voice-first direction faster than the upstream release cadence allows.

## Features

- **🧠 On-device chat** — run GGUF language models (Gemma, Qwen, Phi, Llama, and more) fully offline.
- **🎤 Voice input (Arxell)** — talk to your assistant; Moonshine transcribes on-device.
- **🗣️ Text-to-speech** — give your assistant a voice with on-device neural TTS (Kokoro and other engines), no cloud calls.
- **🎭 Agents** — create personalized assistants with their own model, system prompt, and personality (Assistant and Roleplay types).
- **🛠️ Talents & tools** — let capable agents call built-in tools (calculator, date/time, rich HTML rendering) inside a tool-use loop.
- **📥 Hugging Face integration** — search and download GGUF models, including gated ones, directly from the HF Hub with your access token.
- **📊 Local benchmarking** — measure tokens/sec and memory entirely on-device.
- **⚡ Hardware acceleration** — CPU, GPU (Metal on iOS, OpenCL/Adreno on Android), and NPU (Qualcomm Hexagon) inference paths, with graceful fallback.
- **🌍 Localized** — available in many languages, on phones and tablets, including full iPad support.

## How it works

Arxell inherits PocketPal's four-layer stack, from the silicon up to the chat UI. Each layer has one job, and the dependency direction is strictly top-down — the JS app talks to native bridges, bridges talk to inference engines, engines target hardware backends.

| Layer             | What runs here                                                                                                                                                                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI & Tool Use** | The React Native app (UI via React Native Paper, state via MobX, chat history in WatermelonDB). The **`AgentRunner`** drives each chat turn — streaming tokens, dispatching **Talents** (tools) when the model calls them, and feeding results back for follow-up reasoning. Arxell adds the **STT pipeline** (mic → Silero VAD → Moonshine) here.                  |
| **Bridging**      | Native modules that connect JavaScript to the engines. [`llama.rn`](https://github.com/mybigday/llama.rn) bridges LLM inference; [`@pocketpalai/react-native-speech`](https://github.com/a-ghorbani/react-native-speech) and `onnxruntime-react-native` bridge text-to-speech; [`@siteed/moonshine.rn`](https://github.com/deeeed/audiolab) bridges speech-to-text. |
| **Engine**        | The inference engines. **llama.cpp** runs language models in the quantized **GGUF** format. **ONNX Runtime** runs TTS voice models and the Silero VAD / Moonshine ASR models in the **ONNX** format.                                                                                                                                                                |
| **Hardware**      | Where the math actually happens. Targets **CPU** (universal fallback), **GPU** (Metal on iOS, OpenCL on Qualcomm Adreno for Android), and **NPU** (Qualcomm Hexagon) — falling back gracefully.                                                                                                                                                                     |

## Using the app

1. **Install** Arxell.
2. **Download a model** — open the menu (☰) → **Models**, pick one that fits your phone, and download (or add one from Hugging Face).
3. **(Optional) Set up voice** — in onboarding or from the chat input, install **Voice input** (Moonshine streaming, ~52 MB) and/or **Voice output** (Kokoro) so you can speak to your agent and hear it reply.
4. **Load a model and start chatting** — tap the mic to dictate, or type.

## For developers

Arxell is a standard React Native app. If you can build a React Native project, you can build Arxell.

### Prerequisites

- **Node.js** — version is pinned in [`.nvmrc`](.nvmrc); run `nvm use` to match it.
- **Yarn 1 (Classic)** — `packageManager` is pinned in `package.json`.
- **Xcode** + **CocoaPods** (iOS), and **Android Studio** + Android SDK/NDK (Android).

> **Native-change rule:** if you change `package.json`, a native module, `ios/`, `android/`, the Podfile, or `build.gradle`, re-run `pod install` and rebuild both platforms — a JS reload won't pick up native changes. This is especially relevant for Arxell's STT stack: `@siteed/moonshine.rn` requires **Android minSdk 35 (Android 15)+**.

### Clone, install & run

```bash
git clone <this-fork>
cd arxell

nvm use                       # match the pinned Node version
yarn install                  # install JS dependencies
(cd ios && pod install)       # iOS only

yarn start                    # Metro bundler
yarn ios                      # build + run on iOS simulator
yarn android                  # build + run on Android emulator/device
```

### Quality gates

```bash
yarn lint           # ESLint
yarn typecheck      # tsc --noEmit
yarn test           # Jest
yarn l10n:validate  # validate locale JSON (placeholders, integrity)
```

### STT architecture (Arxell-specific)

```
mic (16 kHz mono PCM)
  → bundled Silero VAD (onnxruntime-react-native)
  → gated speech segment
  → Moonshine tiny-streaming (ASR, via @siteed/moonshine.rn)
  → streaming transcript → chat input → (auto)submit
```

- **VAD** (`silero_vad.onnx`) is **bundled** in the app (`android/app/src/main/assets/stt/`, iOS app bundle) — never a user download.
- **Moonshine tiny-streaming** (~52 MB) is user-installed on first use from Moonshine's model CDN.
- See `src/services/stt/` (runtime, engines, models, VAD) and `src/store/STTStore.ts`.

## Contributing

Contributions are welcome. Because Arxell tracks upstream PocketPal AI closely, please check whether a change belongs upstream first — anything that improves the core on-device experience is best contributed there so everyone benefits. Arxell-specific changes (voice input, the STT pipeline, voice-first onboarding) are perfect for this repo.

1. Fork and branch.
2. Make your changes; rebuild native if you touched native code.
3. Gate locally: `yarn lint && yarn typecheck && yarn test`.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/).
5. Open a pull request.

## Acknowledgements

Arxell stands on the shoulders of giants — first and foremost **[PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai)** and its author **Amin Ghorbani**, who did the hard work of making real on-device LLM inference feel effortless on a phone. Please go star ⭐ the upstream project and consider [sponsoring Amin](https://github.com/sponsors/a-ghorbani).

Arxell also builds directly on these open-source projects:

- **[PocketPal AI](https://github.com/a-ghorbani/pocketpal-ai)** — the foundation: on-device GGUF chat, agents, tool use, TTS, hardware acceleration.
- **[llama.cpp](https://github.com/ggerganv/llama.cpp)** — efficient on-device LLM inference.
- **[llama.rn](https://github.com/mybigday/llama.rn)** — llama.cpp bindings for React Native.
- **[Moonshine](https://github.com/UsefulSensors/moonshine)** (Useful Sensors) — fast on-device speech recognition.
- **[@siteed/moonshine.rn](https://github.com/deeeed/audiolab)** — React Native bindings for Moonshine.
- **[Silero VAD](https://github.com/snakers4/silero-vad)** — voice-activity detection for clean endpointing.
- **[@pocketpalai/react-native-speech](https://github.com/a-ghorbani/react-native-speech)** — React Native TTS bridge.
- **[ONNX Runtime](https://onnxruntime.ai/)** — cross-platform inference for TTS, VAD, and ASR.
- **[React Native](https://reactnative.dev/)**, **[MobX](https://mobx.js.org/)**, **[React Native Paper](https://callstack.github.io/react-native-paper/)**, **[React Navigation](https://reactnavigation.org/)**, **[WatermelonDB](https://github.com/Nozbe/WatermelonDB)**, and the broader OSS community.

## License

Licensed under the [MIT License](LICENSE) — same as upstream PocketPal AI.

<div align="center">
<br/>

Made with ❤️ for people who want AI — and now a voice for it — that stays on their phone.

<br/>

<sub>Arxell is a fork of PocketPal AI and is not affiliated with or endorsed by the PocketPal AI project.</sub>

</div>

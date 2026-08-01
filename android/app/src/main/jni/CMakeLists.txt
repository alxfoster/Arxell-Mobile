# Arxell application CMake.
#
# Why this file exists at all: dropping `externalNativeBuild.cmake.path`
# in build.gradle disables the React Native plugin's auto-injection of
# its default-app-setup CMakeLists, so we own the `appmodules` library
# from here on. The `include(...)` below is what keeps autolinking,
# TurboModule registration, and prefab linkage to libreactnative.so
# working — i.e. it's what makes the app boot.
#
# Why our extra source lives in a subdirectory: RN's template at
# default-app-setup/ReactNative-application.cmake does
# `file(GLOB *.cpp)` non-recursively in this directory, treating the
# presence of any *.cpp here as "user owns OnLoad.cpp too." Keeping
# `hardware_info.cpp` under src/ leaves that glob empty so the upstream
# default-app-setup/OnLoad.cpp (PlatformConstants + autolinked
# TurboModules + Fabric registry) keeps being picked up. We then add
# our source explicitly via `target_sources` after the include.
# Net effect: no vendored Meta code, nothing to resync on RN bumps.

cmake_minimum_required(VERSION 3.13)

# Library name expected by RN; do not rename — SoLoader maps it at startup.
project(appmodules)

# --- eSpeak-ng (on-device phonemization for the Inflect engine) ------------
# Build the engine as a static lib and link it into libappmodules.so so the
# JNI shim (src/espeak_ng.cpp) can call espeak_TextToPhonemes.
include(FetchContent)
FetchContent_Declare(sonic-git
  GIT_REPOSITORY https://github.com/waywardgeek/sonic.git
  GIT_TAG fbf75c3d6d846bad3bb3d456cbc5d07d9fd8c104)
FetchContent_MakeAvailable(sonic-git)
add_library(sonic OBJECT ${sonic-git_SOURCE_DIR}/sonic.c)
set_property(TARGET sonic PROPERTY POSITION_INDEPENDENT_CODE ON)
target_include_directories(sonic PUBLIC ${sonic-git_SOURCE_DIR})
# Pre-seed the find_library/find_path results in cmake/deps.cmake so it
# detects our in-tree sonic (the NDK sysroot has none).
set(SONIC_LIB sonic)
set(SONIC_INC ${sonic-git_SOURCE_DIR})
# Engine only — no data/test/intonation-compile steps during cross-build;
# the espeak-ng-data bundle ships as Android assets instead.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(COMPILE_INTONATIONS OFF CACHE BOOL "" FORCE)
set(ENABLE_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory(third-party/espeak-ng espeakng EXCLUDE_FROM_ALL)

include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)

target_sources(${CMAKE_PROJECT_NAME} PRIVATE
  src/hardware_info.cpp
  src/espeak_ng.cpp
)

find_library(log-lib log)
target_link_libraries(${CMAKE_PROJECT_NAME} ${log-lib} espeak-ng)

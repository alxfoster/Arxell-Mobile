package com.pocketpal

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.pocketpal.specs.NativeModelFolderImportSpec

class ModelFolderImportPackage : TurboReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == NativeModelFolderImportSpec.NAME) {
      ModelFolderImportModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        NativeModelFolderImportSpec.NAME to ReactModuleInfo(
          NativeModelFolderImportSpec.NAME,
          NativeModelFolderImportSpec.NAME,
          false,
          false,
          false,
          false,
          true
        )
      )
    }
  }
}

package com.pocketpal

import android.net.Uri
import android.provider.DocumentsContract
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.pocketpal.specs.NativeModelFolderImportSpec
import java.io.File
import java.util.concurrent.Executors

/** Recursively imports GGUFs from a user-authorized SAF directory tree. */
@ReactModule(name = NativeModelFolderImportSpec.NAME)
class ModelFolderImportModule(private val reactContext: ReactApplicationContext) :
    NativeModelFolderImportSpec(reactContext) {

  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = NativeModelFolderImportSpec.NAME

  override fun importModelFolder(treeUri: String, deleteSources: Boolean, promise: Promise) {
    executor.execute {
      try {
        val root = Uri.parse(treeUri)
        val rootId = DocumentsContract.getTreeDocumentId(root)
        val destinationDir = File(reactContext.filesDir, "models/local")
        if (!destinationDir.exists() && !destinationDir.mkdirs()) {
          throw IllegalStateException("Could not create the local model directory")
        }

        val results = mutableListOf<WritableMap>()
        importChildren(root, rootId, destinationDir, deleteSources, results)
        val array = Arguments.createArray()
        results.forEach(array::pushMap)
        promise.resolve(array)
      } catch (error: Exception) {
        promise.reject("MODEL_FOLDER_IMPORT_FAILED", error.message, error)
      }
    }
  }

  private fun importChildren(
      treeUri: Uri,
      parentDocumentId: String,
      destinationDir: File,
      deleteSources: Boolean,
      results: MutableList<WritableMap>
  ) {
    val childrenUri =
        DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentDocumentId)
    val projection =
        arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
            DocumentsContract.Document.COLUMN_SIZE)

    reactContext.contentResolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      val idColumn =
          cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DOCUMENT_ID)
      val nameColumn =
          cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME)
      val mimeColumn =
          cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE)
      val sizeColumn = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_SIZE)

      while (cursor.moveToNext()) {
        val documentId = cursor.getString(idColumn)
        val displayName = cursor.getString(nameColumn) ?: continue
        val mimeType = cursor.getString(mimeColumn)
        if (mimeType == DocumentsContract.Document.MIME_TYPE_DIR) {
          importChildren(treeUri, documentId, destinationDir, deleteSources, results)
          continue
        }
        if (!displayName.endsWith(".gguf", ignoreCase = true)) {
          continue
        }

        val sourceUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
        val sourceSize = if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) {
          cursor.getLong(sizeColumn)
        } else {
          -1L
        }
        results.add(importFile(sourceUri, displayName, sourceSize, destinationDir, deleteSources))
      }
    }
  }

  private fun importFile(
      sourceUri: Uri,
      displayName: String,
      sourceSize: Long,
      destinationDir: File,
      deleteSource: Boolean
  ): WritableMap {
    val result = Arguments.createMap()
    result.putString("sourceName", displayName)
    result.putBoolean("sourceDeleted", false)

    var temporary: File? = null
    try {
      val safeName = File(displayName).name
      val preferredDestination = File(destinationDir, safeName)

      // A repeated folder import must not create model_1, model_2, ... copies.
      // Treat an equal-sized, valid GGUF with the same name as already
      // imported. A genuine filename collision with a different size keeps
      // both files through uniqueDestination().
      if (
          sourceSize > 0 &&
              preferredDestination.isFile &&
              preferredDestination.length() == sourceSize &&
              hasGgufMagic(preferredDestination) &&
              sourceHasGgufMagic(sourceUri)
      ) {
        result.putString("destinationPath", preferredDestination.absolutePath)
        if (deleteSource) {
          result.putBoolean(
              "sourceDeleted",
              DocumentsContract.deleteDocument(reactContext.contentResolver, sourceUri))
        }
        return result
      }

      val destination =
          if (preferredDestination.exists()) uniqueDestination(destinationDir, safeName)
          else preferredDestination
      temporary = File(destinationDir, ".${destination.name}.importing")

      val header = ByteArray(4)
      var headerLength = 0
      var bytesWritten = 0L
      reactContext.contentResolver.openInputStream(sourceUri)?.use { input ->
        temporary.outputStream().buffered(COPY_BUFFER_BYTES).use { output ->
          val buffer = ByteArray(COPY_BUFFER_BYTES)
          while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (headerLength < header.size) {
              val headerCount = minOf(count, header.size - headerLength)
              buffer.copyInto(header, headerLength, 0, headerCount)
              headerLength += headerCount
            }
            output.write(buffer, 0, count)
            bytesWritten += count
          }
        }
      } ?: throw IllegalStateException("Could not open $displayName")

      if (headerLength != 4 || !header.contentEquals(GGUF_MAGIC)) {
        throw IllegalArgumentException("$displayName is not a valid GGUF file")
      }
      if (sourceSize >= 0 && bytesWritten != sourceSize) {
        throw IllegalStateException("$displayName was not copied completely")
      }
      if (!temporary.renameTo(destination)) {
        throw IllegalStateException("Could not finalize $displayName")
      }
      temporary = null

      result.putString("destinationPath", destination.absolutePath)
      if (deleteSource) {
        val deleted = DocumentsContract.deleteDocument(reactContext.contentResolver, sourceUri)
        result.putBoolean("sourceDeleted", deleted)
        if (!deleted) {
          result.putString("error", "Imported, but the original could not be removed")
        }
      }
    } catch (error: Exception) {
      result.putString("error", error.message ?: "Import failed")
    } finally {
      temporary?.delete()
    }
    return result
  }

  private fun hasGgufMagic(file: File): Boolean =
      try {
        file.inputStream().use { input ->
          val header = ByteArray(4)
          input.read(header) == 4 && header.contentEquals(GGUF_MAGIC)
        }
      } catch (_: Exception) {
        false
      }

  private fun sourceHasGgufMagic(uri: Uri): Boolean =
      try {
        reactContext.contentResolver.openInputStream(uri)?.use { input ->
          val header = ByteArray(4)
          input.read(header) == 4 && header.contentEquals(GGUF_MAGIC)
        } ?: false
      } catch (_: Exception) {
        false
      }

  private fun uniqueDestination(directory: File, originalName: String): File {
    var destination = File(directory, originalName)
    if (!destination.exists()) return destination

    val extensionIndex = originalName.lastIndexOf('.')
    val base = if (extensionIndex > 0) originalName.substring(0, extensionIndex) else originalName
    val extension = if (extensionIndex > 0) originalName.substring(extensionIndex) else ""
    var counter = 1
    while (destination.exists()) {
      destination = File(directory, "${base}_$counter$extension")
      counter++
    }
    return destination
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }

  companion object {
    private val GGUF_MAGIC = byteArrayOf('G'.code.toByte(), 'G'.code.toByte(), 'U'.code.toByte(), 'F'.code.toByte())
    private const val COPY_BUFFER_BYTES = 1024 * 1024
  }
}

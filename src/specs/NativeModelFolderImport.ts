import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export type ImportedModelFile = {
  sourceName: string;
  destinationPath?: string;
  sourceDeleted: boolean;
  error?: string;
};

export interface Spec extends TurboModule {
  /** Recursively import GGUF files from a persisted Android document tree. */
  importModelFolder(
    treeUri: string,
    deleteSources: boolean,
  ): Promise<ReadonlyArray<ImportedModelFile>>;
}

export default TurboModuleRegistry.get<Spec>('ModelFolderImportModule');

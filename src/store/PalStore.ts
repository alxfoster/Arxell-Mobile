/**
 * PalStore - Dynamic Parameter Pal Store
 *
 * This is the new pal store that replaces the legacy PalStore with a flexible,
 * schema-driven approach that supports dynamic parameters and custom Agent types.
 *
 * KEY FEATURES:
 * - Dynamic parameter schemas: Create pals with any custom parameters
 * - Unified UI: Single PalSheet component works for all pal types
 * - Offline-first: Agents are created, imported, and stored entirely on device
 * - Extensible: Easy to add new parameter types (text, select, datetime_tag)
 * - Migration: Automatically migrates data from legacy PalStore on startup
 *
 * @see src/types/pal.ts for type definitions
 * @see src/utils/pal-migration.ts for migration utilities
 * @see src/components/PalsSheets/PalSheet.tsx for unified UI component
 */

import {makeAutoObservable, runInAction} from 'mobx';

import {palRepository} from '../repositories/PalRepository';
import type {Pal} from '../types/pal';
import {deletePalThumbnail} from '../utils/imageUtils';

import {registerDefaultTalents} from '../services/talents';
import {LOOKIE_DEFAULT_MODEL} from './builtinPalModels';

class PalStore {
  // Core pals storage
  pals: Pal[] = [];

  // Migration state
  isMigrating: boolean = false;
  migrationComplete: boolean = false;
  migrationVersion: string = '1.0';

  constructor() {
    makeAutoObservable(this);
    this.initialize();
    console.log('Pal store initialized');
    console.log('Pals number: ', this.pals.length);
  }

  async initialize() {
    try {
      runInAction(() => {
        this.isMigrating = true;
      });

      // Migrate from JSON/AsyncStorage to database
      await palRepository.checkAndMigrateFromJSON();

      // Load pals from database
      await this.loadPalsFromDatabase();

      // Initialize Lookie pal after database is loaded
      await this.initializeLookiePal();

      // Initialize Pip pal (idempotent — see initializePipPal).
      await this.initializePipPal();

      // Register talent engines (idempotent)
      registerDefaultTalents();

      console.log('Pal store initialization completed');

      runInAction(() => {
        this.isMigrating = false;
        this.migrationComplete = true;
      });
    } catch (error) {
      console.error('Failed to initialize pal store:', error);
      runInAction(() => {
        this.isMigrating = false;
        this.migrationComplete = false;
      });
    }
  }

  /**
   * Load pals from database into MobX store
   */
  private async loadPalsFromDatabase() {
    try {
      // LocalPal normalizes records created by older builds to local Agents
      // while preserving prompts, models, talents, greetings, and settings.
      const pals = await palRepository.getAllPals();
      runInAction(() => {
        this.pals = pals;
      });
    } catch (error) {
      console.error('Error loading pals from database:', error);
    }
  }

  // Core unified pal management methods

  /**
   * Adds a pal to both repository and store (handles persistence + state)
   * This is the ONLY method that should handle repository + store updates
   */
  private addPal = async (
    palData: Omit<Pal, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Pal> => {
    const savedPal = await palRepository.createPal(palData);

    runInAction(() => {
      this.pals.push(savedPal);
    });

    return savedPal;
  };

  /**
   * Creates a new pal
   */
  createPal = async (
    palData: Omit<Pal, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<Pal> => {
    return this.addPal(palData);
  };

  /**
   * Updates an existing pal
   */
  updatePal = async (id: string, updates: Partial<Pal>): Promise<void> => {
    try {
      const updatedPal = await palRepository.updatePal(id, updates);
      if (updatedPal) {
        runInAction(() => {
          const palIndex = this.pals.findIndex(p => p.id === id);
          if (palIndex !== -1) {
            this.pals[palIndex] = updatedPal;
          }
        });
      } else {
        throw new Error('Failed to update pal - no updated pal returned');
      }
    } catch (error) {
      console.error('Error updating pal:', error);
      throw error; // Re-throw so calling code can handle it
    }
  };

  /**
   * Deletes a pal
   */
  deletePal = async (id: string): Promise<void> => {
    try {
      // Find the pal to get its thumbnail path before deletion
      const palIndex = this.pals.findIndex(p => p.id === id);
      const pal = palIndex !== -1 ? this.pals[palIndex] : null;

      const success = await palRepository.deletePal(id);
      if (success) {
        // Clean up local thumbnail image if it exists
        if (pal?.thumbnail_url) {
          try {
            await deletePalThumbnail(pal.thumbnail_url);
          } catch (imageError) {
            console.warn('Failed to delete thumbnail image:', imageError);
            // Don't fail the entire deletion if image cleanup fails
          }
        }

        runInAction(() => {
          if (palIndex !== -1) {
            this.pals.splice(palIndex, 1);
          }
        });
      }
    } catch (error) {
      console.error('Error deleting pal:', error);
    }
  };

  /**
   * Gets all pals
   */
  getPals = (): Pal[] => {
    return this.pals;
  };

  getAllPals = (): Pal[] => this.pals;

  getLocalPals = (): Pal[] => this.pals;

  getVideoPals = (): Pal[] =>
    this.pals.filter(pal => pal.capabilities?.video === true);

  /**
   * Gets a pal by ID
   */
  getPalById = (id: string): Pal | undefined => {
    return this.pals.find(p => p.id === id);
  };

  /** Reload locally persisted Agents without contacting a remote service. */
  refreshLocalPals = async (): Promise<void> => {
    await this.loadPalsFromDatabase();
  };

  /**
   * Initialize the default "Lookie" VideoPal if it doesn't exist
   */
  private async initializeLookiePal(): Promise<void> {
    try {
      // Check if Lookie already exists
      const lookiePal = this.pals.find(
        p => p.capabilities?.video === true && p.name === 'Lookie',
      );

      if (!lookiePal) {
        console.log('Creating default Lookie pal...');

        // Offline constant — no network resolve at pal init.
        const defaultModel = LOOKIE_DEFAULT_MODEL;

        // Create the Lookie pal with all the original properties
        const palData: Omit<Pal, 'id' | 'created_at' | 'updated_at'> = {
          type: 'local',
          name: 'Lookie',
          description:
            'Real-time video analysis assistant that provides concise descriptions of your camera feed.',
          systemPrompt:
            'You are Lookie, an AI assistant giving real-time, concise descriptions of a video feed. Use few words. If unsure, say so clearly.',
          isSystemPromptChanged: false,
          useAIPrompt: false,
          defaultModel: defaultModel, // Set the default model so users know what to download
          parameters: {
            captureInterval: '3000', // 3 seconds (original value) - stored as string for text input
          },
          parameterSchema: [
            {
              key: 'captureInterval',
              type: 'text',
              label: 'Capture Interval (ms)',
              required: false,
            },
          ],
          capabilities: {video: true},
          color: ['#9E204F', '#F6E1EA'], // Original Lookie colors
          source: 'local',
        };

        await this.addPal(palData);
      } else {
        console.log('Lookie pal already exists, skipping creation');
      }
    } catch (error) {
      console.error('Error initializing Lookie pal:', error);
    }
  }

  /**
   * Initialize the default "Pip" recommended pal if it doesn't exist.
   *
   * Idempotent: a re-entry never overwrites an existing Pip record, so a
   * `defaultModel` bound from a prior session (e.g. by the onboarding
   * recommended-pal picker) survives subsequent app starts.
   */
  private async initializePipPal(): Promise<void> {
    try {
      const existing = this.pals.find(
        p => p.name === 'Pip' && p.source === 'local',
      );
      if (existing) {
        return;
      }

      const palData: Omit<Pal, 'id' | 'created_at' | 'updated_at'> = {
        type: 'local',
        name: 'Pip',
        description:
          'A friendly general-purpose pal that runs entirely on your phone.',
        systemPrompt:
          'You are Pip, a friendly and helpful assistant who runs locally on the user’s phone. Keep replies concise and warm.',
        isSystemPromptChanged: false,
        useAIPrompt: false,
        defaultModel: undefined,
        parameters: {},
        parameterSchema: [],
        capabilities: {},
        color: ['#0E0D0C', '#FAFAFA'],
        source: 'local',
      };

      await this.addPal(palData);
    } catch (error) {
      console.error('Error initializing Pip pal:', error);
    }
  }
}

export const palStore = new PalStore();

// Export types for external use
export type {Pal} from '../types/pal';
export type {LegacyPalData} from '../utils/pal-migration';

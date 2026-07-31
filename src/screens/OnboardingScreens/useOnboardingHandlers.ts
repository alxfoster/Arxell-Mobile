import {useCallback, useContext, useEffect, useRef, useState} from 'react';
import {useNavigation} from '@react-navigation/native';

import {uiStore, palStore, modelStore} from '../../store';
import {L10nContext} from '../../utils';
import {ROUTES} from '../../utils/navigationConstants';
import {
  entryId,
  resolvePalForTopic,
} from '../../store/onboarding/onboardingPals';
import type {Pal} from '../../types/pal';
import type {OnboardingStep, TopicKey} from '../../store/onboarding/types';

/**
 * Per-screen onboarding helpers: mark `currentStep` on mount, expose
 * `goNext` / `goBack` / `skip` / `finish` / `selectTopic` that route through
 * the single-writer methods on `uiStore` (and, on finish, materialise the
 * topic-matched local pal, bind the picked model, and kick off the download
 * via `modelStore`).
 */
export const useOnboardingHandlers = (step: OnboardingStep) => {
  const navigation = useNavigation<any>();
  const l10n = useContext(L10nContext);
  // In-flight guard for finish(). useRef gives the synchronous early-exit
  // (a re-entrant call before React commits the next render returns
  // immediately); useState drives the disabled-CTA UI.
  const finishingRef = useRef(false);
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    uiStore.setOnboardingStep(step);
  }, [step]);

  const skip = useCallback(() => {
    uiStore.completeOnboarding({
      topic: uiStore.onboardingState.selectedTopic,
      modelId: null,
    });
  }, []);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [navigation]);

  const goTo = useCallback(
    (name: string) => {
      navigation.navigate(name);
    },
    [navigation],
  );

  const next = useCallback(() => {
    const map: Record<OnboardingStep, string | null> = {
      1: ROUTES.ONBOARDING.STEP_5,
      5: ROUTES.ONBOARDING.STEP_6,
      6: ROUTES.ONBOARDING.STEP_7,
      7: null,
    };
    const target = map[step];
    if (target) {
      goTo(target);
    }
  }, [step, goTo]);

  // Screen-5 chip tap: write topic + navigate in the same handler
  // (single forward control — there is no Continue button on screen 5).
  const selectTopic = useCallback(
    (key: TopicKey | null) => {
      uiStore.setOnboardingTopic(key);
      goTo(ROUTES.ONBOARDING.STEP_6);
    },
    [goTo],
  );

  // Step 6 CTA: materialise the topic-matched pal, bind the picked model,
  // and kick off the LLM download (fire-and-forget) — then advance to the
  // optional voice-setup step. Onboarding is NOT completed here; step 7's
  // `finish()` (or the chrome Skip) does that.
  const confirmAndContinue = useCallback(async () => {
    if (finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    setIsFinishing(true);
    try {
      const modelId = uiStore.onboardingState.selectedModelId;
      const topic = uiStore.onboardingState.selectedTopic;
      if (modelId) {
        const palDef = resolvePalForTopic(topic);
        const entry = palDef.models.find(m => entryId(m) === modelId);
        const picked = entry
          ? await modelStore.registerOnboardingPalModel(entry)
          : undefined;
        const greeting = palDef.greeting
          ? {
              text: palDef.greeting.text,
              suggestedPrompts: [...palDef.greeting.suggestedPrompts],
            }
          : undefined;
        const existing = palStore.pals.find(
          p => p.name === palDef.name && p.source === 'local',
        );
        if (existing) {
          if (picked) {
            await palStore.updatePal(existing.id, {
              defaultModel: picked,
              ...(greeting ? {greeting} : {}),
            });
          }
        } else {
          const palData: Omit<Pal, 'id' | 'created_at' | 'updated_at'> = {
            type: 'local',
            name: palDef.name,
            description: palDef.description,
            systemPrompt: palDef.systemPrompt,
            isSystemPromptChanged: false,
            useAIPrompt: false,
            defaultModel: picked,
            parameters: {},
            parameterSchema: [],
            capabilities: {},
            color: palDef.color,
            source: 'local',
            ...(greeting ? {greeting} : {}),
          };
          await palStore.createPal(palData);
        }
        if (picked) {
          modelStore.checkSpaceAndDownload(picked.id).catch(() => {
            // intentionally swallowed — downloadError already drives the UI.
          });
        }
      }
      goTo(ROUTES.ONBOARDING.STEP_7);
    } finally {
      finishingRef.current = false;
      setIsFinishing(false);
    }
  }, [goTo]);

  // Step 7 CTA (and the final step of the whole flow): complete onboarding.
  // Voice-model installs started on step 7 continue in the background.
  const finish = useCallback(async () => {
    if (finishingRef.current) {
      return;
    }
    finishingRef.current = true;
    setIsFinishing(true);
    try {
      uiStore.completeOnboarding({
        topic: uiStore.onboardingState.selectedTopic,
        modelId: uiStore.onboardingState.selectedModelId,
      });
    } finally {
      finishingRef.current = false;
      setIsFinishing(false);
    }
  }, []);

  return {
    l10n,
    next,
    goBack,
    skip,
    finish,
    confirmAndContinue,
    selectTopic,
    isFinishing,
  };
};

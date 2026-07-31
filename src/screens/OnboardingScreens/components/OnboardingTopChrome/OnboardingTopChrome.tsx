import React, {useCallback, useContext} from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {observer} from 'mobx-react';

import {useTheme} from '../../../../hooks';
import {uiStore} from '../../../../store';
import {L10nContext} from '../../../../utils';
import {OnboardingSkipButton} from '../OnboardingSkipButton';
import {createStyles} from './styles';

export type OnboardingChromeStep = 'splash' | 1 | 5 | 6 | 7 | null;

/**
 * Persistent onboarding top chrome — Stepper + top-right action — rendered
 * once at the OnboardingStack level, overlaid above the navigator. Driven
 * by the active route name (mapped to a step) so the chrome stays put
 * while the screen body slides in/out underneath.
 *
 * Per-step contract:
 *   - splash / unknown → hidden
 *   - 1 / 5            → Skip (screen 1 leads directly to topic picking)
 *   - 6                → no Stepper + "Skip for now" (telegraphs that the
 *                        deferred action is downloading, not browsing copy)
 *   - 7                → no Stepper + "Skip for now" (optional voice setup)
 */
export const OnboardingTopChrome: React.FC<{step: OnboardingChromeStep}> =
  observer(({step}) => {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const styles = createStyles(theme, insets.top);
    const l10n = useContext(L10nContext);
    const t = l10n.onboarding;

    const onSkip = useCallback(() => {
      uiStore.completeOnboarding({
        topic: uiStore.onboardingState.selectedTopic,
        modelId: null,
      });
    }, []);

    if (step === null || step === 'splash') {
      return null;
    }

    let topRight: React.ReactNode = null;
    if (step >= 1 && step <= 5) {
      topRight = <OnboardingSkipButton label={t.skip} onPress={onSkip} />;
    } else if (step === 6 || step === 7) {
      topRight = <OnboardingSkipButton label={t.skipForNow} onPress={onSkip} />;
    }

    return (
      <View pointerEvents="box-none" style={styles.root}>
        <View pointerEvents="box-none" style={styles.band}>
          {topRight ? (
            <View style={styles.topRightSlot}>{topRight}</View>
          ) : null}
        </View>
      </View>
    );
  });

/** Map a React Navigation route name to a chrome step. */
export const chromeStepFromRouteName = (
  name: string | undefined,
  routes: {
    SPLASH: string;
    STEP_1: string;
    STEP_5: string;
    STEP_6: string;
    STEP_7: string;
  },
): OnboardingChromeStep => {
  switch (name) {
    case routes.SPLASH:
      return 'splash';
    case routes.STEP_1:
      return 1;
    case routes.STEP_5:
      return 5;
    case routes.STEP_6:
      return 6;
    case routes.STEP_7:
      return 7;
    default:
      return null;
  }
};

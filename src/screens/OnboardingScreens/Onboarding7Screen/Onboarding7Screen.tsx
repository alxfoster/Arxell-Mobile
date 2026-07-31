import React, {useEffect} from 'react';
import {View} from 'react-native';
import {Button, ProgressBar, Text} from 'react-native-paper';
import {observer} from 'mobx-react';

import {sttStore, ttsStore} from '../../../store';
import {useTheme} from '../../../hooks';
import {OnboardingScaffold} from '../components/OnboardingScaffold';
import {OnboardingBottomBar} from '../components/OnboardingBottomBar';
import {ItalicAccentTitle} from '../components/ItalicAccentTitle';
import {useOnboardingHandlers} from '../useOnboardingHandlers';
import {createStyles} from './styles';

/**
 * Step 7 — optional voice setup. Detects whether the STT (Moonshine) and
 * TTS (Kokoro) models are present and offers a one-tap install for each.
 * Both are optional: the primary CTA always finishes onboarding, and any
 * in-flight install keeps running in the background.
 *
 * The LLM was committed on step 6; this screen never blocks on it.
 */
export const Onboarding7Screen: React.FC = observer(() => {
  const {l10n, goBack, finish, isFinishing} = useOnboardingHandlers(7);
  const theme = useTheme();
  const styles = createStyles(theme);
  const t = l10n.onboarding.screen7;

  // Make sure availability reflects reality (STT store probes disk in
  // init(); this re-probes on mount in case init() raced ahead of the
  // bundled-asset copy).
  useEffect(() => {
    sttStore.init().catch(() => {});
  }, []);

  // --- STT (Moonshine) state ---
  const sttInstalled = sttStore.modelsInstalled;
  const sttBusy = sttStore.isInstallingModels;
  const sttPct = Math.round(sttStore.modelDownloadProgress * 100);
  const onStt = () => sttStore.installModels().catch(() => {});

  // --- TTS (Kokoro) state ---
  const ttsState = ttsStore.kokoroDownloadState; // not_installed|downloading|ready|error
  const ttsInstalled = ttsState === 'ready';
  const ttsBusy = ttsState === 'downloading';
  const ttsPct = Math.round((ttsStore.kokoroDownloadProgress ?? 0) * 100);
  const onTts = () => ttsStore.downloadKokoro();

  return (
    <OnboardingScaffold
      step={7}
      layout="top"
      content={
        <>
          <View style={styles.header}>
            <ItalicAccentTitle title={t.title} accent={t.titleAccent} />
            <Text style={styles.body}>{t.body}</Text>
          </View>
          <View style={styles.options}>
            {/* Voice input — Moonshine tiny-streaming (~52 MB) */}
            <View style={styles.card}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{t.sttTitle}</Text>
                <Text style={styles.cardSubtitle}>
                  {sttInstalled
                    ? t.installed
                    : sttBusy
                      ? `${t.installing} ${sttPct}%`
                      : t.sttSubtitle}
                </Text>
                {sttBusy ? (
                  <ProgressBar
                    style={styles.progressBar}
                    progress={sttStore.modelDownloadProgress}
                    color={theme.colors.primary}
                  />
                ) : null}
              </View>
              <View style={styles.action}>
                {sttInstalled ? (
                  <Text style={styles.cardSubtitle}>{t.done}</Text>
                ) : (
                  <Button
                    mode="contained"
                    onPress={onStt}
                    disabled={sttBusy}
                    compact>
                    {sttBusy ? `${sttPct}%` : t.install}
                  </Button>
                )}
              </View>
            </View>

            {/* Voice output — Kokoro (default TTS) */}
            <View style={styles.card}>
              <View style={styles.cardText}>
                <Text style={styles.cardTitle}>{t.ttsTitle}</Text>
                <Text style={styles.cardSubtitle}>
                  {ttsInstalled
                    ? t.installed
                    : ttsBusy
                      ? `${t.installing} ${ttsPct}%`
                      : t.ttsSubtitle}
                </Text>
                {ttsBusy ? (
                  <ProgressBar
                    style={styles.progressBar}
                    progress={ttsStore.kokoroDownloadProgress ?? 0}
                    color={theme.colors.primary}
                  />
                ) : null}
              </View>
              <View style={styles.action}>
                {ttsInstalled ? (
                  <Text style={styles.cardSubtitle}>{t.done}</Text>
                ) : (
                  <Button
                    mode="contained"
                    onPress={onTts}
                    disabled={ttsBusy}
                    compact>
                    {ttsBusy ? `${ttsPct}%` : t.install}
                  </Button>
                )}
              </View>
            </View>
          </View>
        </>
      }
      bottomBar={
        <OnboardingBottomBar
          primaryLabel={t.cta}
          onPrimary={finish}
          primaryDisabled={isFinishing}
          onBack={goBack}
          backAccessibilityLabel={l10n.onboarding.back}
          elevated
        />
      }
    />
  );
});

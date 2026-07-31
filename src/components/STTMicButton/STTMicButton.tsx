import * as React from 'react';
import {Alert, Pressable} from 'react-native';
import {observer} from 'mobx-react';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {ActivityIndicator} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {sttStore, ttsStore} from '../../store';

import {createStyles} from './styles';

export interface STTMicButtonProps {
  /** Tint to match the input bar's on-surface color. */
  color?: string;
}

/**
 * Floating mic button for tap-to-dictate (v1). Tap once to start a session;
 * tap again to stop. While listening, partial transcript streams into the
 * chat input (wired in ChatView); on end-of-speech the finalized text is
 * auto-submitted (or left for review, per sttStore.autoSubmit).
 *
 * Audio-focus coordination: starting STT stops any in-flight TTS playback
 * first (mic and playback contend for the audio session / AudioFocus).
 *
 * Hidden entirely when STT is disabled (sttStore.endpoint === 'disabled').
 * Positioning (float above the input bar, track keyboard) is handled by the
 * parent — this component is just the button.
 */
export const STTMicButton = observer(({color}: STTMicButtonProps) => {
  const theme = useTheme();
  const styles = createStyles({theme});
  const listening = sttStore.isListening;
  const starting = sttStore.sessionState.mode === 'starting';
  const processing = sttStore.sessionState.mode === 'processing';
  const busy = starting || processing;
  const shownError = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!sttStore.lastError) {
      shownError.current = null;
      return;
    }
    if (sttStore.lastError === shownError.current) {
      return;
    }
    shownError.current = sttStore.lastError;
    Alert.alert('Voice input unavailable', sttStore.lastError);
  }, [sttStore.lastError]);

  const handlePress = () => {
    if (sttStore.isInstallingModels || busy) {
      return;
    }
    if (!sttStore.modelsInstalled) {
      Alert.alert(
        'Install voice input?',
        'Voice input downloads its streaming speech-recognition model once (about 52 MB). Audio is processed on this device.',
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Install',
            onPress: () => {
              sttStore.installModels().catch(() => {
                // The store retains the error; a later tap retries the install.
              });
            },
          },
        ],
      );
      return;
    }
    if (listening) {
      sttStore.stop();
      return;
    }
    // Stop TTS before capturing so playback and mic capture never overlap.
    ttsStore
      .stop()
      .catch(() => {})
      .finally(() => {
        sttStore.start();
      });
  };

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        sttStore.isInstallingModels
          ? `Installing voice input ${Math.round(sttStore.modelDownloadProgress * 100)}%`
          : starting
            ? 'Starting voice input'
            : processing
              ? 'Processing voice input'
              : !sttStore.modelsInstalled
                ? 'Install voice input'
                : listening
                  ? 'Stop voice input'
                  : 'Start voice input'
      }
      disabled={busy || sttStore.isInstallingModels}
      testID="stt-mic-button"
      style={[styles.button, listening && styles.buttonListening]}>
      {sttStore.isInstallingModels || busy ? (
        <ActivityIndicator size={20} />
      ) : (
        <Icon
          name={
            listening
              ? 'stop'
              : sttStore.modelsInstalled
                ? 'microphone'
                : 'download'
          }
          size={28}
          color={
            listening
              ? theme.colors.onSecondaryContainer
              : (color ?? theme.colors.secondary)
          }
        />
      )}
    </Pressable>
  );
});

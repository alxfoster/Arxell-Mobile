import * as React from 'react';
import {Alert, Platform, Pressable, ToastAndroid} from 'react-native';
import {observer} from 'mobx-react';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';
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
  // Only the listening phase represents an open, active microphone. Starting
  // and final processing are busy states, but must not retain the active fill.
  const listening = sttStore.sessionState.mode === 'listening';
  const starting = sttStore.sessionState.mode === 'starting';
  const processing = sttStore.sessionState.mode === 'processing';
  const busy = starting || processing;
  const handsFree = sttStore.handsFreeEnabled;
  const lastError = sttStore.lastError;
  const shownError = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!lastError) {
      shownError.current = null;
      return;
    }
    if (lastError === shownError.current) {
      return;
    }
    shownError.current = lastError;
    Alert.alert('Voice input unavailable', lastError);
  }, [lastError]);

  const handlePress = () => {
    if (handsFree) {
      sttStore.disableHandsFree();
      return;
    }
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

  const handleLongPress = () => {
    if (
      sttStore.isInstallingModels ||
      busy ||
      !sttStore.modelsInstalled ||
      handsFree
    ) {
      // Missing models still use the established tap-to-install flow.
      return;
    }
    ReactNativeHapticFeedback.trigger('notificationSuccess', {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
    if (Platform.OS === 'android') {
      ToastAndroid.show(
        'Hands-free voice enabled · Tap the mic to turn it off',
        ToastAndroid.SHORT,
      );
    }
    // Stop current playback before opening capture. Subsequent assistant
    // speech may overlap capture so VAD can provide genuine barge-in.
    ttsStore
      .stop()
      .catch(() => {})
      .finally(() => {
        sttStore.enableHandsFree();
      });
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={1000}
      accessibilityRole="button"
      accessibilityLabel={
        sttStore.isInstallingModels
          ? `Installing voice input ${Math.round(sttStore.modelDownloadProgress * 100)}%`
          : !sttStore.modelsInstalled
            ? 'Install voice input'
            : handsFree
              ? 'Hands-free microphone active; tap to disable'
              : starting
                ? 'Starting voice input'
                : processing
                  ? 'Processing voice input'
                  : listening
                    ? 'Stop voice input'
                    : 'Start voice input'
      }
      accessibilityHint={
        handsFree
          ? 'Stops continuous voice conversation'
          : 'Long press to enable hands-free conversation'
      }
      disabled={(!handsFree && busy) || sttStore.isInstallingModels}
      testID="stt-mic-button"
      style={[
        styles.button,
        listening && styles.buttonListening,
        handsFree && styles.buttonHandsFree,
      ]}>
      {sttStore.isInstallingModels || busy ? (
        <ActivityIndicator size={20} />
      ) : (
        <Icon
          testID="stt-mic-icon"
          name={
            handsFree
              ? 'microphone'
              : listening
                ? 'stop'
                : sttStore.modelsInstalled
                  ? 'microphone'
                  : 'download'
          }
          size={28}
          // The active container is blue in the dark theme, so use a fixed
          // black glyph rather than a theme accent that can disappear into it.
          color={
            listening || handsFree
              ? '#000000'
              : (color ?? theme.colors.secondary)
          }
        />
      )}
    </Pressable>
  );
});

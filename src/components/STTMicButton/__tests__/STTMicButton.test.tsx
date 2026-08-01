import React from 'react';

import {fireEvent, render} from '../../../../jest/test-utils';
import {Alert} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {L10nContext} from '../../../utils';
import {l10n} from '../../../locales';
import {sttStore} from '../../../store';

import {STTMicButton} from '../STTMicButton';

const renderButton = () =>
  render(
    <L10nContext.Provider value={l10n.en}>
      <STTMicButton />
    </L10nContext.Provider>,
  );

describe('STTMicButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (sttStore as any).isListening = false;
    (sttStore as any).modelsInstalled = true;
    (sttStore as any).sessionState = {mode: 'idle'};
    (sttStore as any).isInstallingModels = false;
    (sttStore as any).modelDownloadProgress = 0;
  });

  it('renders the mic icon when ready', () => {
    const {getByTestId} = renderButton();
    const button = getByTestId('stt-mic-button');
    expect(button).toBeTruthy();
  });

  it('stops an in-flight session on tap', () => {
    (sttStore as any).isListening = true;
    (sttStore as any).sessionState = {mode: 'listening'};
    const {getByTestId} = renderButton();
    fireEvent.press(getByTestId('stt-mic-button'));
    expect(sttStore.stop).toHaveBeenCalledTimes(1);
    expect(sttStore.start).not.toHaveBeenCalled();
  });

  it('starts a session when models are installed and idle', async () => {
    const {getByTestId} = renderButton();
    fireEvent.press(getByTestId('stt-mic-button'));
    // start() runs inside ttsStore.stop().catch().finally() — flush the
    // two-deep promise chain before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(sttStore.start).toHaveBeenCalledTimes(1);
  });

  it('prompts to install when models are missing (and does not start)', () => {
    (sttStore as any).modelsInstalled = false;
    const {getByTestId} = renderButton();
    fireEvent.press(getByTestId('stt-mic-button'));
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(sttStore.start).not.toHaveBeenCalled();
  });

  it('does nothing while installing', () => {
    (sttStore as any).isInstallingModels = true;
    const {getByTestId} = renderButton();
    fireEvent.press(getByTestId('stt-mic-button'));
    expect(sttStore.start).not.toHaveBeenCalled();
    expect(sttStore.stop).not.toHaveBeenCalled();
  });

  it('uses a black icon while the microphone is actively listening', () => {
    (sttStore as any).isListening = true;
    (sttStore as any).sessionState = {mode: 'listening'};
    const {UNSAFE_getByType} = renderButton();

    expect(UNSAFE_getByType(Icon).props.color).toBe('#000000');
  });

  it('cannot start another recording while final transcription is processing', () => {
    (sttStore as any).isListening = true;
    (sttStore as any).sessionState = {mode: 'processing'};
    const {getByLabelText} = renderButton();
    const button = getByLabelText('Processing voice input');

    fireEvent.press(button);

    expect(sttStore.start).not.toHaveBeenCalled();
    expect(sttStore.stop).not.toHaveBeenCalled();
    expect(button.props.style[1]).toBeFalsy();
  });

  it('shows a disabled ready indicator while the native models start', () => {
    (sttStore as any).sessionState = {mode: 'starting'};
    const {getByLabelText} = renderButton();
    const button = getByLabelText('Starting voice input');

    fireEvent.press(button);

    expect(button).toBeDisabled();
    expect(sttStore.start).not.toHaveBeenCalled();
    expect(sttStore.stop).not.toHaveBeenCalled();
  });
});

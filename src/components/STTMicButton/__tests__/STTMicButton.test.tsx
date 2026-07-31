import React from 'react';

import {fireEvent, render} from '../../../../jest/test-utils';
import {Alert} from 'react-native';

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
});

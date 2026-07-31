import {I18nManager, StyleSheet} from 'react-native';

import type {Theme} from '../../../../utils/types';

export const createStyles = (theme: Theme, topInset: number) =>
  StyleSheet.create({
    root: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
    },
    band: {
      height: topInset + 60,
      position: 'relative',
    },
    topRightSlot: {
      position: 'absolute',
      top: topInset + 16,
      // Logical end edge: physical right in LTR, physical left in RTL.
      ...(I18nManager.isRTL ? {left: 16} : {right: 16}),
    },
  });

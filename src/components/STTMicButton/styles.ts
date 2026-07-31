import {StyleSheet} from 'react-native';

import type {Theme} from '../../utils/types';

export const createStyles = ({theme}: {theme: Theme}) =>
  StyleSheet.create({
    button: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: theme.stroke.sm,
      borderColor: theme.colors.secondary,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
      elevation: 3,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 3,
      shadowOffset: {width: 0, height: 1},
    },
    buttonListening: {
      backgroundColor: theme.colors.secondaryContainer,
      borderColor: theme.colors.secondary,
    },
  });

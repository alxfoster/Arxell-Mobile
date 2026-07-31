import {StyleSheet} from 'react-native';

import type {Theme} from '../../../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    chip: {
      // Figma `888:30378`: bg muted/subtle, radius m=12, padding sm.
      alignSelf: 'center',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.radius.m,
      backgroundColor: theme.colors.surface,
      borderWidth: theme.stroke.sm,
      borderColor: theme.colors.secondary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    text: {
      ...theme.typography.captionM,
      color: theme.colors.secondary,
      opacity: 0.7,
    },
    bullet: {
      width: 1.5,
      height: 1.5,
      borderRadius: 1,
      backgroundColor: theme.colors.secondary,
      opacity: 0.7,
    },
  });

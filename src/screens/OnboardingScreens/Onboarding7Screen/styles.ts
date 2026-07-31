import {StyleSheet} from 'react-native';

import type {Theme} from '../../../utils/types';

export const createStyles = (theme: Theme) =>
  StyleSheet.create({
    header: {
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.m,
      marginBottom: theme.spacing.ml,
    },
    title: {
      ...theme.typography.titleL,
      color: theme.colors.onBackground,
      textAlign: 'center',
    },
    body: {
      ...theme.typography.bodyS,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      width: 335,
    },
    options: {
      width: 335,
      alignSelf: 'center',
      gap: theme.spacing.s,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.m,
      padding: theme.spacing.m,
      borderRadius: theme.radius.m,
      borderWidth: 1,
      borderColor: theme.colors.outline,
      backgroundColor: theme.colors.surface,
    },
    cardText: {
      flex: 1,
    },
    cardTitle: {
      ...theme.typography.bodyM,
      color: theme.colors.onSurface,
      fontWeight: '600',
    },
    cardSubtitle: {
      ...theme.typography.captionM,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
      marginTop: theme.spacing.xs,
    },
    action: {
      minWidth: 96,
    },
  });

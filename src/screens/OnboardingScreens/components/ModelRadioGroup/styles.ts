import {StyleSheet} from 'react-native';

import type {Theme} from '../../../../utils/types';

export const createStyles = (
  theme: Theme,
  selected: boolean,
  recommended: boolean,
) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.ml,
      borderRadius: theme.radius.l,
      borderWidth: theme.stroke.sm,
      borderColor: theme.colors.secondary,
      backgroundColor: selected
        ? theme.colors.secondaryContainer
        : theme.colors.background,
      marginBottom: theme.spacing.s,
      shadowColor: theme.colors.shadow,
      shadowOffset: {width: 0, height: 2},
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 2,
    },
    radio: {
      width: 16,
      height: 16,
      borderRadius: 16,
      borderWidth: selected ? 1.5 : 1,
      borderColor: theme.colors.secondary,
      backgroundColor: selected
        ? theme.colors.secondaryContainer
        : theme.colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioDot: {
      width: 8,
      height: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.onSecondaryContainer,
    },
    body: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.s,
    },
    title: {
      ...theme.typography.titleS,
      color: selected
        ? theme.colors.onSecondaryContainer
        : theme.colors.secondary,
    },
    subtitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
    },
    subtitle: {
      ...theme.typography.captionS,
      color: selected
        ? theme.colors.onSecondaryContainer
        : theme.colors.secondary,
      opacity: 0.7,
    },
    badge: {
      paddingHorizontal: theme.spacing.s,
      paddingVertical: theme.spacing.xxs,
      borderRadius: theme.radius.xs,
      backgroundColor: theme.colors.background,
      borderWidth: theme.stroke.sm,
      borderColor: theme.colors.secondary,
    },
    badgeText: {
      ...theme.typography.captionM,
      fontWeight: '500',
      color: theme.colors.secondary,
    },
  });

import {Image} from 'react-native';
import React, {useContext, useMemo, useState} from 'react';

import {FAB} from 'react-native-paper';

import {useTheme} from '../../../hooks';
import {L10nContext} from '../../../utils';
import {CloudPlusIcon} from '../../../assets/icons';
import {createStyles} from './styles';

interface FABGroupProps {
  onAddHFModel: () => void;
  onAddLocalModel: () => void;
  onImportModelFolder?: () => void;
  onAddRemoteModel: () => void;
  onManageServers?: () => void;
  hasServers?: boolean;
}

const iconStyle = {width: 24, height: 24};

// Icon component type for react-native-paper FAB actions
type IconComponentProps = {
  size: number;
  allowFontScaling?: boolean;
  color: string;
};

const HFIcon = (_props: IconComponentProps): React.ReactNode => (
  <Image source={require('../../../assets/icon-hf.png')} style={iconStyle} />
);

const RemoteIcon = (props: IconComponentProps): React.ReactNode => (
  <CloudPlusIcon width={props.size} height={props.size} stroke={props.color} />
);

export const FABGroup: React.FC<FABGroupProps> = ({
  onAddHFModel,
  onAddLocalModel,
  onImportModelFolder,
  onAddRemoteModel,
  onManageServers,
  hasServers,
}) => {
  const [open, setOpen] = useState(false);
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const styles = createStyles(theme);

  const onStateChange = ({open: isOpen}) => setOpen(isOpen);

  const actions = useMemo(() => {
    const items = [
      {
        testID: 'hf-fab',
        icon: HFIcon,
        label: l10n.models.buttons.addFromHuggingFace,
        accessibilityLabel: l10n.models.buttons.addFromHuggingFace,
        style: styles.actionButton,
        onPress: () => {
          onAddHFModel();
        },
      },
      {
        testID: 'local-fab',
        icon: 'folder-plus',
        color: theme.colors.primary,
        label: l10n.models.buttons.addLocalModel,
        accessibilityLabel: l10n.models.buttons.addLocalModel,
        style: styles.actionButton,
        onPress: () => {
          onAddLocalModel();
        },
      },
      ...(onImportModelFolder
        ? [
            {
              testID: 'model-folder-fab',
              icon: 'folder-multiple-plus',
              color: theme.colors.primary,
              label: 'Import Models Folder',
              accessibilityLabel: 'Import Models Folder',
              style: styles.actionButton,
              onPress: onImportModelFolder,
            },
          ]
        : []),
      {
        testID: 'remote-fab',
        icon: RemoteIcon,
        color: theme.colors.primary,
        label: l10n.settings.addRemoteModel,
        accessibilityLabel: l10n.settings.addRemoteModel,
        style: styles.actionButton,
        onPress: () => {
          onAddRemoteModel();
        },
      },
    ];
    if (hasServers && onManageServers) {
      items.push({
        testID: 'manage-servers-fab',
        icon: 'server-network',
        color: theme.colors.primary,
        label: l10n.settings.manageServers,
        accessibilityLabel: l10n.settings.manageServers,
        style: styles.actionButton,
        onPress: () => {
          onManageServers();
        },
      });
    }
    return items;
  }, [
    l10n,
    onAddHFModel,
    onAddLocalModel,
    onImportModelFolder,
    onAddRemoteModel,
    onManageServers,
    hasServers,
    styles.actionButton,
    theme.colors.primary,
  ]);

  return (
    <FAB.Group
      testID="fab-group"
      open={open}
      visible={true}
      icon={open ? 'close' : 'plus'}
      actions={actions}
      onStateChange={onStateChange}
      onPress={() => {
        if (open) {
          console.log('FAB Group closed');
        } else {
          console.log('FAB Group opened');
        }
      }}
      fabStyle={styles.fab}
      color={theme.colors.primary}
      backdropColor={theme.colors.surface}
      accessibilityLabel={open ? 'Close menu' : 'Open menu'}
    />
  );
};

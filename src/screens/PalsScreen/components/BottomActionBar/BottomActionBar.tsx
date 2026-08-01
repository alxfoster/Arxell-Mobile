import React, {useContext} from 'react';
import {View, TouchableOpacity} from 'react-native';
import {Text} from 'react-native-paper';
import {observer} from 'mobx-react-lite';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {SearchIcon} from '../../../../assets/icons';
import {useTheme} from '../../../../hooks';
import {L10nContext} from '../../../../utils';
import {createStyles} from './styles';
import {AddPalMenu} from '../AddPalMenu';

export type BottomActionType = 'search' | 'add';

interface BottomActionBarProps {
  activeAction: BottomActionType;
  onActionPress: (action: BottomActionType) => void;
  onCreatePal: (type: 'assistant' | 'roleplay' | 'video') => void;
}

export const BottomActionBar: React.FC<BottomActionBarProps> = observer(
  ({onActionPress, onCreatePal}) => {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const styles = createStyles(theme, insets);
    const l10n = useContext(L10nContext);
    const iconColor = theme.colors.onSurfaceVariant;

    return (
      <View style={styles.container}>
        <View style={styles.actionBar}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => onActionPress('search')}
            testID="bottom-action-search">
            <View style={styles.iconContainer}>
              <SearchIcon stroke={iconColor} width={24} height={24} />
            </View>
            <Text style={styles.actionLabel}>{l10n.palsScreen.search}</Text>
          </TouchableOpacity>

          <AddPalMenu
            iconColor={iconColor}
            iconSize={24}
            onCreatePal={onCreatePal}
          />
        </View>
      </View>
    );
  },
);

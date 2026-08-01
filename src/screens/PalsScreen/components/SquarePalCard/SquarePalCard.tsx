import React, {useContext} from 'react';
import {View, TouchableOpacity, Dimensions, Image, Alert} from 'react-native';
import {observer} from 'mobx-react-lite';
import {useNavigation} from '@react-navigation/native';
import {Text, Card, IconButton} from 'react-native-paper';

import {
  ChatIcon,
  CameraIcon,
  TrashIcon,
  ShareIcon,
} from '../../../../assets/icons';
import {useTheme} from '../../../../hooks';
import {createStyles} from './styles';
import type {Pal} from '../../../../types/pal';
import {palStore, chatSessionStore, modelStore} from '../../../../store';
import {L10nContext} from '../../../../utils';
import {t} from '../../../../locales';
import {exportPal} from '../../../../utils/exportUtils';
import {ROUTES} from '../../../../utils/navigationConstants';
import {getContrastColor} from '../../../../utils/colorUtils';
import {getFullThumbnailUri} from '../../../../utils/imageUtils';
import {hasVideoCapability} from '../../../../utils/pal-capabilities';

interface SquarePalCardProps {
  pal: Pal;
  onPress: () => void;
  /** Retained for source compatibility; every displayed Agent is local. */
  isLocal?: boolean;
}

const truncateText = (text: string, maxLength: number): string => {
  if (!text || text.length <= maxLength) {
    return text || '';
  }
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return `${lastSpace > maxLength * 0.7 ? truncated.substring(0, lastSpace) : truncated}...`;
};

const getDisplayContent = (pal: Pal): string => {
  if (pal.description) {
    return truncateText(pal.description, 100);
  }
  const parameters = Object.values(pal.parameters ?? {})
    .filter(value => typeof value === 'string' && value.trim())
    .slice(0, 3)
    .join(' • ');
  if (parameters) {
    return truncateText(parameters, 100);
  }
  return truncateText(
    (pal.systemPrompt || '')
      .replace(/^You(?:'re| are)\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim(),
    80,
  );
};

const PalThumbnail: React.FC<{pal: Pal; onChatPress: () => void}> = ({
  pal,
  onChatPress,
}) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const colors =
    Array.isArray(pal.color) && pal.color.length >= 2
      ? pal.color
      : (['#333333', '#e5e5e6'] as [string, string]);
  const thumbnailUrl = pal.thumbnail_url
    ? getFullThumbnailUri(pal.thumbnail_url)
    : undefined;

  return (
    <View style={[styles.thumbnail, {backgroundColor: colors[0]}]}>
      {thumbnailUrl ? (
        <Image
          source={{uri: thumbnailUrl}}
          style={styles.thumbnailImage}
          resizeMode="cover"
        />
      ) : (
        <Text
          style={[styles.thumbnailText, {color: getContrastColor(colors[0])}]}>
          {pal.name?.[0]?.toUpperCase() || 'A'}
        </Text>
      )}
      <TouchableOpacity style={styles.chatButton} onPress={onChatPress}>
        {hasVideoCapability(pal) ? (
          <CameraIcon stroke={theme.colors.primary} width={18} height={18} />
        ) : (
          <ChatIcon stroke={theme.colors.primary} width={18} height={18} />
        )}
      </TouchableOpacity>
    </View>
  );
};

export const SquarePalCard: React.FC<SquarePalCardProps> = observer(
  ({pal, onPress}) => {
    const theme = useTheme();
    const styles = createStyles(theme);
    const l10n = useContext(L10nContext);
    const navigation = useNavigation();
    const cardWidth = (Dimensions.get('window').width - 48) / 2;

    const shouldShowModelWarning =
      !!pal.defaultModel && !modelStore.isModelAvailable(pal.defaultModel.id);

    const handleStartChat = async () => {
      try {
        await chatSessionStore.setActivePal(pal.id);
        if (pal.defaultModel && !modelStore.activeModel) {
          const model = modelStore.availableModels.find(
            candidate => candidate.id === pal.defaultModel?.id,
          );
          if (model) {
            await modelStore.selectModel(model);
          }
        } else if (
          pal.defaultModel &&
          pal.defaultModel.id !== modelStore.activeModelId
        ) {
          const model = modelStore.availableModels.find(
            candidate => candidate.id === pal.defaultModel?.id,
          );
          if (model) {
            Alert.alert(
              'Switch Model?',
              `Switch to "${model.name}" for this Agent?`,
              [
                {text: 'Keep Current', style: 'cancel'},
                {text: 'Switch', onPress: () => modelStore.selectModel(model)},
              ],
            );
          }
        }
        (navigation as any).navigate(ROUTES.CHAT);
      } catch (error) {
        console.error('Error starting chat:', error);
        Alert.alert('Error', 'Failed to start chat. Please try again.');
      }
    };

    const handleDelete = () => {
      Alert.alert(
        l10n.palsScreen.deletePal,
        t(l10n.palsScreen.deletePalConfirmation, {palName: pal.name}),
        [
          {text: l10n.common.cancel, style: 'cancel'},
          {
            text: l10n.common.delete,
            style: 'destructive',
            onPress: () => palStore.deletePal(pal.id),
          },
        ],
      );
    };

    const handleShare = async () => {
      try {
        await exportPal(pal.id);
      } catch (error) {
        console.error('Error sharing Agent:', error);
        Alert.alert('Share Error', 'Failed to share Agent. Please try again.');
      }
    };

    const colors = pal.color;
    return (
      <View>
        <TouchableOpacity
          testID={`local-pal-card-${pal.id}`}
          style={[styles.container, {width: cardWidth}]}
          onPress={onPress}
          activeOpacity={0.7}>
          <Card
            elevation={0}
            style={[styles.card, colors && {borderColor: colors[1]}]}>
            <View style={styles.cardContent}>
              <PalThumbnail pal={pal} onChatPress={handleStartChat} />
              <View style={styles.content}>
                <View style={styles.header}>
                  <View style={styles.nameSection}>
                    <Text style={styles.palName} numberOfLines={1}>
                      {pal.name}
                    </Text>
                  </View>
                  <View style={styles.headerActions}>
                    <IconButton
                      icon={() => (
                        <ShareIcon
                          stroke={theme.colors.onSurface}
                          width={16}
                          height={16}
                        />
                      )}
                      size={20}
                      style={styles.actionButton}
                      onPress={handleShare}
                    />
                    <IconButton
                      icon={() => (
                        <TrashIcon
                          stroke={theme.colors.error}
                          width={16}
                          height={16}
                        />
                      )}
                      size={20}
                      style={styles.actionButton}
                      onPress={handleDelete}
                    />
                  </View>
                </View>
                <View style={styles.middleContent}>
                  {!!getDisplayContent(pal) && (
                    <Text
                      style={styles.description}
                      numberOfLines={shouldShowModelWarning ? 1 : 2}>
                      {getDisplayContent(pal)}
                    </Text>
                  )}
                  {shouldShowModelWarning && (
                    <View style={styles.warningContainer}>
                      <IconButton
                        icon="alert-circle-outline"
                        iconColor={theme.colors.error}
                        size={14}
                        style={styles.warningIcon}
                      />
                      <Text style={styles.warningText} numberOfLines={1}>
                        {
                          l10n.components.modelNotAvailable
                            .modelNotDownloadedShort
                        }
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          </Card>
        </TouchableOpacity>
      </View>
    );
  },
);

import React, {useCallback, useState} from 'react';
import {View, FlatList, RefreshControl} from 'react-native';
import {Text} from 'react-native-paper';
import {observer} from 'mobx-react-lite';

import {PlusIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {createStyles} from './styles';
import {
  BottomActionBar,
  BottomActionType,
  ExpandableSearch,
  FilterChips,
  FilterType,
  SquarePalCard,
} from './components';
import {PalSheet} from '../../components/PalsSheets';
import {
  createNewAssistantPal,
  createNewRoleplayPal,
  createNewVideoPal,
  preparePalForEditing,
} from '../../utils/pal-templates';
import {palStore, Pal} from '../../store';
import {hasVideoCapability} from '../../utils/pal-capabilities';

/** Local, offline Agent library. */
export const PalsScreen: React.FC = observer(() => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [activeAction, setActiveAction] = useState<BottomActionType>('search');
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [searchResults, setSearchResults] = useState<Pal[] | null>(null);
  const [showPalSheet, setShowPalSheet] = useState(false);
  const [currentPal, setCurrentPal] = useState<Partial<Pal> | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const handleCreatePal = (type: 'assistant' | 'roleplay' | 'video') => {
    const newPal =
      type === 'roleplay'
        ? createNewRoleplayPal()
        : type === 'video'
          ? createNewVideoPal()
          : createNewAssistantPal();
    setCurrentPal(newPal);
    setShowPalSheet(true);
  };

  const handleEditPal = (pal: Pal) => {
    setCurrentPal(preparePalForEditing(pal));
    setShowPalSheet(true);
  };

  const handleActionPress = (action: BottomActionType) => {
    setActiveAction(action);
    if (action === 'search') {
      setIsSearchExpanded(value => !value);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await palStore.refreshLocalPals();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const sourcePals = searchResults ?? palStore.getPals();
  const displayedPals =
    activeFilter === 'video'
      ? sourcePals.filter(hasVideoCapability)
      : sourcePals;

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <PlusIcon stroke={theme.colors.onSurfaceVariant} width={48} height={48} />
      <Text style={styles.emptyStateText}>
        {'No Agents yet.\nCreate your first Agent using the + button!'}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <ExpandableSearch
        isExpanded={isSearchExpanded}
        onToggle={() => setIsSearchExpanded(value => !value)}
        onSearchResults={setSearchResults}
      />

      <FilterChips
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
      />

      <FlatList
        data={displayedPals}
        keyExtractor={item => item.id}
        renderItem={({item}) => (
          <SquarePalCard
            pal={item}
            onPress={() => handleEditPal(item)}
            isLocal
          />
        )}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
        testID="pals-flat-list"
      />

      <BottomActionBar
        activeAction={activeAction}
        onActionPress={handleActionPress}
        onCreatePal={handleCreatePal}
      />

      {showPalSheet && currentPal && (
        <PalSheet
          isVisible={showPalSheet}
          onClose={() => {
            setShowPalSheet(false);
            setCurrentPal(null);
          }}
          pal={currentPal}
        />
      )}
    </View>
  );
});

export default PalsScreen;

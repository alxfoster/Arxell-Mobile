import React, {useEffect, useMemo, useState} from 'react';
import {View, Animated, TextInput, TouchableOpacity} from 'react-native';
import {observer} from 'mobx-react-lite';

import {SearchIcon, XIcon} from '../../../../assets/icons';
import {useTheme} from '../../../../hooks';
import {createStyles} from './styles';
import {palStore} from '../../../../store/PalStore';
import type {Pal} from '../../../../types/pal';

interface ExpandableSearchProps {
  isExpanded: boolean;
  onToggle: () => void;
  /** null means no active query; an empty array means a query had no matches. */
  onSearchResults: (results: Pal[] | null) => void;
}

export const ExpandableSearch: React.FC<ExpandableSearchProps> = observer(
  ({isExpanded, onToggle, onSearchResults}) => {
    const theme = useTheme();
    const styles = createStyles(theme);
    const [searchQuery, setSearchQuery] = useState('');
    const animatedHeight = useMemo(() => new Animated.Value(0), []);

    useEffect(() => {
      Animated.timing(animatedHeight, {
        toValue: isExpanded ? 70 : 0,
        duration: 250,
        useNativeDriver: false,
      }).start();
    }, [isExpanded, animatedHeight]);

    const localSearchIndex = palStore.pals
      .map(pal => `${pal.id}:${pal.name}:${pal.description ?? ''}`)
      .join('\u0000');

    useEffect(() => {
      const query = searchQuery.trim().toLocaleLowerCase();
      if (!query) {
        onSearchResults(null);
        return;
      }

      const timer = setTimeout(() => {
        onSearchResults(
          palStore
            .getPals()
            .filter(pal =>
              [pal.name, pal.description, pal.systemPrompt].some(value =>
                value?.toLocaleLowerCase().includes(query),
              ),
            ),
        );
      }, 150);
      return () => clearTimeout(timer);
    }, [searchQuery, onSearchResults, localSearchIndex]);

    const handleClose = () => {
      setSearchQuery('');
      onSearchResults(null);
      onToggle();
    };

    if (!isExpanded) {
      return null;
    }

    return (
      <Animated.View
        style={[styles.container, {height: animatedHeight}]}
        testID="expandable-search">
        <View style={styles.searchContent}>
          <View style={styles.searchInputContainer}>
            <SearchIcon
              stroke={theme.colors.onSurfaceVariant}
              width={20}
              height={20}
              style={styles.searchIcon}
            />
            <TextInput
              placeholder="Search your Agents"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              value={searchQuery}
              onChangeText={setSearchQuery}
              style={styles.searchInput}
              autoFocus={isExpanded}
              returnKeyType="search"
              testID="search-input"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                style={styles.clearButton}
                testID="clear-search-button">
                <XIcon
                  stroke={theme.colors.onSurfaceVariant}
                  width={16}
                  height={16}
                />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.searchActions}>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeButton}
              testID="close-search-button">
              <XIcon
                stroke={theme.colors.onSurfaceVariant}
                width={18}
                height={18}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    );
  },
);

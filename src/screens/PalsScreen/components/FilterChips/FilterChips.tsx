import React from 'react';
import {View, ScrollView} from 'react-native';
import {Chip} from 'react-native-paper';
import {observer} from 'mobx-react-lite';

import {useTheme} from '../../../../hooks';
import {createStyles} from './styles';

export type FilterType = 'all' | 'video';

interface FilterChipsProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
}

export const FilterChips: React.FC<FilterChipsProps> = observer(
  ({activeFilter, onFilterChange}) => {
    const theme = useTheme();
    const styles = createStyles(theme);
    const options: Array<{key: FilterType; label: string}> = [
      {key: 'all', label: 'All'},
      {key: 'video', label: 'Video'},
    ];

    return (
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}>
          {options.map(option => (
            <Chip
              testID={`filter-chip-${option.key}`}
              key={option.key}
              mode={activeFilter === option.key ? 'flat' : 'outlined'}
              selected={activeFilter === option.key}
              onPress={() => onFilterChange(option.key)}
              style={[
                styles.chip,
                activeFilter === option.key && styles.activeChip,
              ]}
              textStyle={[
                styles.chipText,
                activeFilter === option.key && styles.activeChipText,
              ]}
              compact>
              {option.label}
            </Chip>
          ))}
        </ScrollView>
      </View>
    );
  },
);

import React, {useContext} from 'react';
import {View} from 'react-native';

import {Card, Text, Button} from 'react-native-paper';

import {useTheme} from '../../../hooks';
import {L10nContext} from '../../../utils';
import {t} from '../../../locales';

import {createStyles} from './styles';

import {BenchmarkResult} from '../../../utils/types';
import {formatBytes, formatNumber} from '../../../utils';
type Props = {
  result: BenchmarkResult;
  onDelete: (timestamp: string) => void;
};

export const BenchResultCard = ({result, onDelete}: Props) => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const l10n = useContext(L10nContext);
  const formatDuration = (ms: number) => {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <Card elevation={0} style={styles.resultCard}>
      <Card.Content>
        <View style={styles.resultHeader}>
          <View style={styles.headerLeft}>
            <Text variant="titleSmall" style={styles.modelName}>
              {result.modelName}
            </Text>
            <Text style={styles.modelMeta}>
              {formatBytes(result.modelSize)} •{' '}
              {formatNumber(result.modelNParams, 2, true, false)}{' '}
              {l10n.benchmark.benchmarkResultCard.modelMeta.params}
            </Text>
          </View>
          <Button
            testID="delete-result-button"
            mode="text"
            onPress={() => onDelete(result.timestamp)}
            icon="delete"
            compact
            style={styles.deleteButton}>
            {l10n.benchmark.benchmarkResultCard.actions.deleteButton}
          </Button>
        </View>

        <View style={styles.configContainer}>
          <View style={styles.configBar}>
            <Text variant="labelSmall">
              {l10n.benchmark.benchmarkResultCard.config.title}
            </Text>
            <Text style={styles.configText}>
              {t(l10n.benchmark.benchmarkResultCard.config.format, {
                pp: result.config.pp.toString(),
                tg: result.config.tg.toString(),
                pl: result.config.pl.toString(),
                nr: result.config.nr.toString(),
              })}
            </Text>
          </View>

          {result.initSettings && (
            <View style={styles.configBar}>
              <Text variant="labelSmall">
                {l10n.benchmark.benchmarkResultCard.modelSettings.title}
              </Text>
              <View style={styles.configTextContainer}>
                <Text style={styles.configText}>
                  {t(l10n.benchmark.benchmarkResultCard.modelSettings.context, {
                    context: (result.initSettings.n_ctx || 0).toString(),
                  })}{' '}
                  •{' '}
                  {t(l10n.benchmark.benchmarkResultCard.modelSettings.batch, {
                    batch: (result.initSettings.n_batch || 0).toString(),
                  })}{' '}
                  •{' '}
                  {t(l10n.benchmark.benchmarkResultCard.modelSettings.ubatch, {
                    ubatch: (result.initSettings.n_ubatch || 0).toString(),
                  })}
                </Text>
                <Text style={styles.configText}>
                  {t(
                    l10n.benchmark.benchmarkResultCard.modelSettings.cpuThreads,
                    {
                      threads: (result.initSettings.n_threads || 0).toString(),
                    },
                  )}{' '}
                  •{' '}
                  {t(
                    l10n.benchmark.benchmarkResultCard.modelSettings.gpuLayers,
                    {
                      layers: (
                        result.initSettings.n_gpu_layers || 0
                      ).toString(),
                    },
                  )}
                  {(result.initSettings as any).devices &&
                    (result.initSettings as any).devices.length > 0 && (
                      <>
                        {' '}
                        •{' '}
                        {t(
                          l10n.benchmark.benchmarkResultCard.modelSettings
                            .device,
                          {
                            device: (result.initSettings as any).devices.join(
                              ', ',
                            ),
                          },
                        )}
                      </>
                    )}
                </Text>
                <Text style={styles.configText}>
                  {/* Flash Attention Type */}
                  {(() => {
                    // Handle both legacy flash_attn (boolean) and new flash_attn_type (string)
                    const flashAttnType =
                      (result.initSettings as any).flash_attn_type ??
                      ((result.initSettings as any).flash_attn ? 'on' : 'off');

                    if (flashAttnType === 'off') {
                      return l10n.benchmark.benchmarkResultCard.modelSettings
                        .flashAttentionDisabled;
                    } else if (flashAttnType === 'on') {
                      return l10n.benchmark.benchmarkResultCard.modelSettings
                        .flashAttentionEnabled;
                    } else {
                      // 'auto'
                      return l10n.benchmark.benchmarkResultCard.modelSettings
                        .flashAttentionEnabled;
                    }
                  })()}{' '}
                  •{' '}
                  {t(
                    l10n.benchmark.benchmarkResultCard.modelSettings.cacheTypes,
                    {
                      cacheK: (
                        result.initSettings.cache_type_k || 'unknown'
                      ).toString(),
                      cacheV: (
                        result.initSettings.cache_type_v || 'unknown'
                      ).toString(),
                    },
                  )}
                </Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.resultsContainer}>
          <View style={styles.resultRow}>
            <View style={styles.resultItem}>
              <Text style={styles.resultValue}>
                {result.ppAvg?.toFixed(2)}
                <Text style={styles.resultUnit}>
                  {' '}
                  {l10n.benchmark.benchmarkResultCard.results.tokensPerSecond}
                </Text>
              </Text>
              <Text style={styles.resultLabel}>
                {l10n.benchmark.benchmarkResultCard.results.promptProcessing}
              </Text>
            </View>
            <View style={styles.resultItem}>
              <Text style={styles.resultValue}>
                {result.tgAvg?.toFixed(2)}
                <Text style={styles.resultUnit}>
                  {' '}
                  {l10n.benchmark.benchmarkResultCard.results.tokensPerSecond}
                </Text>
              </Text>
              <Text style={styles.resultLabel}>
                {l10n.benchmark.benchmarkResultCard.results.tokenGeneration}
              </Text>
            </View>
          </View>

          {(result.wallTimeMs || result.peakMemoryUsage) && (
            <View style={styles.resultRow}>
              {result.wallTimeMs && (
                <View style={styles.resultItem}>
                  <Text style={styles.resultValue}>
                    {formatDuration(result.wallTimeMs)}
                  </Text>
                  <Text style={styles.resultLabel}>
                    {l10n.benchmark.benchmarkResultCard.results.totalTime}
                  </Text>
                </View>
              )}
              {result.peakMemoryUsage && (
                <View style={styles.resultItem}>
                  <Text style={styles.resultValue}>
                    {result.peakMemoryUsage.percentage.toFixed(1)}%
                  </Text>
                  <Text style={styles.resultLabel}>
                    {l10n.benchmark.benchmarkResultCard.results.peakMemory}
                  </Text>
                  <Text style={styles.resultStd}>
                    {formatBytes(result.peakMemoryUsage.used, 0)} /{' '}
                    {formatBytes(result.peakMemoryUsage.total, 0)}
                  </Text>
                </View>
              )}
            </View>
          )}
          <Text style={styles.timestamp}>
            {new Date(result.timestamp).toLocaleString()}
          </Text>
        </View>
      </Card.Content>
    </Card>
  );
};

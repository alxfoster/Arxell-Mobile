import React from 'react';
import {fireEvent, render} from '../../../../../jest/test-utils';
import {BenchResultCard} from '../BenchResultCard';
import {BenchmarkResult, CacheType} from '../../../../utils/types';
describe('BenchResultCard', () => {
  const mockResult: BenchmarkResult = {
    config: {
      pp: 1,
      tg: 1,
      pl: 512,
      nr: 3,
      label: 'Default',
    },
    modelDesc: 'Test Model',
    modelSize: 1000 * 1000 * 500, // 500 MB
    modelNParams: 7000000000, // 7B
    ppAvg: 20.5,
    ppStd: 1.2,
    tgAvg: 30.5,
    tgStd: 2.1,
    timestamp: new Date().toISOString(),
    modelId: 'test-model-id',
    modelName: 'Test Model',
    filename: 'test-model.gguf',
    uuid: 'test-uuid',
    oid: 'model-oid', // This is needed for sharing
    initSettings: {
      version: '2.0',
      n_ctx: 2048,
      n_batch: 512,
      n_ubatch: 128,
      n_threads: 4,
      n_gpu_layers: 20,
      flash_attn_type: 'auto',
      cache_type_k: CacheType.F16,
      cache_type_v: CacheType.F16,
      use_mmap: 'true' as const,
      use_mlock: false,
    },
    wallTimeMs: 5000, // 5 seconds
    peakMemoryUsage: {
      total: 8 * 1000 * 1000 * 1000, // 8 GB
      used: 4 * 1000 * 1000 * 1000, // 4 GB
      percentage: 50,
    },
  };

  const mockOnDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders benchmark result data correctly', () => {
    const {getByText} = render(
      <BenchResultCard result={mockResult} onDelete={mockOnDelete} />,
    );

    // Model info
    expect(getByText('Test Model')).toBeTruthy();
    expect(getByText(/500 MB/)).toBeTruthy();
    expect(getByText(/7B params/)).toBeTruthy();

    // Benchmark results
    expect(getByText('20.50 t/s')).toBeTruthy();
    expect(getByText('30.50 t/s')).toBeTruthy();

    // Configuration
    expect(getByText(/PP: 1 • TG: 1 • PL: 512 • Rep: 3/)).toBeTruthy();

    // Memory & time
    expect(getByText('5s')).toBeTruthy();
    expect(getByText('50.0%')).toBeTruthy();
    expect(getByText(/4 GB \/ 8 GB/)).toBeTruthy();
  });

  it('formats different durations correctly', () => {
    // Test with milliseconds
    const shortResult = {...mockResult, wallTimeMs: 500};
    const {getByText, rerender} = render(
      <BenchResultCard result={shortResult} onDelete={mockOnDelete} />,
    );
    expect(getByText('500ms')).toBeTruthy();

    // Test with seconds
    const secondsResult = {...mockResult, wallTimeMs: 3500};
    rerender(
      <BenchResultCard result={secondsResult} onDelete={mockOnDelete} />,
    );
    expect(getByText('3s')).toBeTruthy();

    // Test with minutes and seconds
    const minutesResult = {...mockResult, wallTimeMs: 125000}; // 2m 5s
    rerender(
      <BenchResultCard result={minutesResult} onDelete={mockOnDelete} />,
    );
    expect(getByText('2m 5s')).toBeTruthy();
  });

  it('handles delete button press', () => {
    const {getByTestId} = render(
      <BenchResultCard result={mockResult} onDelete={mockOnDelete} />,
    );

    const deleteButton = getByTestId('delete-result-button');
    fireEvent.press(deleteButton);

    expect(mockOnDelete).toHaveBeenCalledWith(mockResult.timestamp);
  });

  it('renders without initSettings or peakMemoryUsage', () => {
    const minimalResult = {
      ...mockResult,
      initSettings: undefined,
      peakMemoryUsage: undefined,
      wallTimeMs: undefined,
    };

    const {queryByText} = render(
      <BenchResultCard result={minimalResult} onDelete={mockOnDelete} />,
    );

    // These should not be in the DOM
    expect(queryByText('Model Settings')).toBeNull();
    expect(queryByText('Peak Memory')).toBeNull();
    expect(queryByText('Total Time')).toBeNull();
  });

  describe('flash attention display', () => {
    it('displays flash attention enabled for flash_attn_type="auto"', () => {
      const resultWithAuto: BenchmarkResult = {
        ...mockResult,
        initSettings: {
          version: '2.0',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 128,
          n_threads: 4,
          n_gpu_layers: 20,
          flash_attn_type: 'auto',
          cache_type_k: CacheType.F16,
          cache_type_v: CacheType.F16,
          use_mmap: 'true',
          use_mlock: false,
        },
      };

      const {getByText} = render(
        <BenchResultCard result={resultWithAuto} onDelete={mockOnDelete} />,
      );

      expect(getByText(/Flash Attention Enabled/)).toBeTruthy();
      expect(getByText(/Cache Types: f16\/f16/)).toBeTruthy();
    });

    it('displays flash attention enabled for flash_attn_type="on"', () => {
      const resultWithOn: BenchmarkResult = {
        ...mockResult,
        initSettings: {
          version: '2.0',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 128,
          n_threads: 4,
          n_gpu_layers: 20,
          flash_attn_type: 'on',
          cache_type_k: CacheType.F16,
          cache_type_v: CacheType.F16,
          use_mmap: 'true',
          use_mlock: false,
        },
      };

      const {getByText} = render(
        <BenchResultCard result={resultWithOn} onDelete={mockOnDelete} />,
      );

      expect(getByText(/Flash Attention Enabled/)).toBeTruthy();
      expect(getByText(/Cache Types: f16\/f16/)).toBeTruthy();
    });

    it('displays flash attention disabled for flash_attn_type="off"', () => {
      const resultWithOff: BenchmarkResult = {
        ...mockResult,
        initSettings: {
          version: '2.0',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 128,
          n_threads: 4,
          n_gpu_layers: 20,
          flash_attn_type: 'off',
          cache_type_k: CacheType.F16,
          cache_type_v: CacheType.F16,
          use_mmap: 'true',
          use_mlock: false,
        },
      };

      const {getByText} = render(
        <BenchResultCard result={resultWithOff} onDelete={mockOnDelete} />,
      );

      expect(getByText(/Flash Attention Disabled/)).toBeTruthy();
      expect(getByText(/Cache Types: f16\/f16/)).toBeTruthy();
    });

    it('handles legacy flash_attn boolean (true)', () => {
      const legacyResult = {
        ...mockResult,
        initSettings: {
          version: '1.0',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 128,
          n_threads: 4,
          n_gpu_layers: 20,
          flash_attn: true, // Legacy boolean
          cache_type_k: CacheType.F16,
          cache_type_v: CacheType.F16,
          use_mmap: 'true' as const,
          use_mlock: false,
        },
      };

      const {getByText} = render(
        <BenchResultCard result={legacyResult} onDelete={mockOnDelete} />,
      );

      // Should display as enabled (legacy true -> auto)
      expect(getByText(/Flash Attention Enabled/)).toBeTruthy();
      expect(getByText(/Cache Types: f16\/f16/)).toBeTruthy();
    });

    it('handles legacy flash_attn boolean (false)', () => {
      const legacyResult = {
        ...mockResult,
        initSettings: {
          version: '1.0',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 128,
          n_threads: 4,
          n_gpu_layers: 20,
          flash_attn: false, // Legacy boolean
          cache_type_k: CacheType.F16,
          cache_type_v: CacheType.F16,
          use_mmap: 'true' as const,
          use_mlock: false,
        },
      };

      const {getByText} = render(
        <BenchResultCard result={legacyResult} onDelete={mockOnDelete} />,
      );

      // Should display as disabled (legacy false -> off)
      expect(getByText(/Flash Attention Disabled/)).toBeTruthy();
      expect(getByText(/Cache Types: f16\/f16/)).toBeTruthy();
    });

    it('displays cache types for all flash attention states', () => {
      // Cache types should be displayed regardless of flash attention state
      const resultWithOff: BenchmarkResult = {
        ...mockResult,
        initSettings: {
          version: '2.0',
          n_ctx: 2048,
          n_batch: 512,
          n_ubatch: 128,
          n_threads: 4,
          n_gpu_layers: 20,
          flash_attn_type: 'off',
          cache_type_k: CacheType.Q8_0,
          cache_type_v: CacheType.Q4_0,
          use_mmap: 'true',
          use_mlock: false,
        },
      };

      const {getByText} = render(
        <BenchResultCard result={resultWithOff} onDelete={mockOnDelete} />,
      );

      expect(getByText(/Flash Attention Disabled/)).toBeTruthy();
      expect(getByText(/Cache Types: q8_0\/q4_0/)).toBeTruthy();
    });
  });
});

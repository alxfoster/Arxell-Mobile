export interface TranscriptLineUpdate {
  lineId: string;
  text: string;
  isFinal?: boolean;
  startedAtMs?: number;
}

interface StoredLine extends TranscriptLineUpdate {
  order: number;
}

/**
 * Builds one utterance from Moonshine's revisable line events. A completed
 * line is stable text, not an end-of-utterance signal; the VAD/stream flush
 * owns that decision.
 */
export class TranscriptAssembler {
  private readonly lines = new Map<string, StoredLine>();
  private nextOrder = 0;

  update(line: TranscriptLineUpdate): string {
    if (!line.lineId) {
      return this.text;
    }
    const existing = this.lines.get(line.lineId);
    // A completed line must not be regressed by a delayed provisional event.
    if (existing?.isFinal && !line.isFinal) {
      return this.text;
    }
    this.lines.set(line.lineId, {
      ...existing,
      ...line,
      isFinal: Boolean(existing?.isFinal || line.isFinal),
      order: existing?.order ?? this.nextOrder++,
    });
    return this.text;
  }

  get text(): string {
    return [...this.lines.values()]
      .sort((a, b) => {
        if (a.startedAtMs != null && b.startedAtMs != null) {
          return a.startedAtMs - b.startedAtMs || a.order - b.order;
        }
        return a.order - b.order;
      })
      .map(line => line.text.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  reset(): void {
    this.lines.clear();
    this.nextOrder = 0;
  }
}

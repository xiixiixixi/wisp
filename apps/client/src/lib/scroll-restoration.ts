/**
 * Per-path scroll memory (#32).
 *
 * Finder restores the exact scroll offset when navigation returns to a
 * recently visited folder — the core "回来还在原地" feel of a browsing file
 * manager. Entries live alongside the pane's path history and evict
 * least-recently-used beyond the cap, so the memory stays bounded no matter
 * how deep a session browses.
 */

/** 60 entries mirrors a generous back/forward session without unbounded growth. */
const DEFAULT_CAPACITY = 60;

export class PathScrollMemory {
  /** Insertion order doubles as recency order (Map preserves it). */
  private readonly entries = new Map<string, number>();

  constructor(readonly capacity: number = DEFAULT_CAPACITY) {}

  private key(scope: string, path: string): string {
    return `${scope}\u0000${path}`;
  }

  remember(scope: string, path: string, scrollTop: number): void {
    // NaN/negative offsets (mid-measurement reads) must not poison a slot.
    if (!Number.isFinite(scrollTop) || scrollTop < 0) return;
    const key = this.key(scope, path);
    // Delete first so a revisit refreshes recency instead of keeping its
    // original insertion position.
    this.entries.delete(key);
    this.entries.set(key, Math.round(scrollTop));
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }

  recall(scope: string, path: string): number | null {
    return this.entries.get(this.key(scope, path)) ?? null;
  }

  forget(scope: string, path: string): void {
    this.entries.delete(this.key(scope, path));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * Pane-scoped singleton: split panes keep independent offset memories keyed
 * by their groupId, and the LRU cap bounds the shared footprint.
 */
export const paneScrollMemory = new PathScrollMemory();

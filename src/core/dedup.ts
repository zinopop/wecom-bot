/**
 * msgId 幂等去重。内存 LRU，容量到上限时清一半。
 * 跨平台共享一个实例即可——msgId 只在同一平台内唯一，但由于前缀不同不会冲突。
 */
export class MsgIdDedup {
  private seen = new Map<string, number>();
  constructor(private capacity = 5000) {}

  check(key: string): boolean {
    if (this.seen.has(key)) return false;
    if (this.seen.size >= this.capacity) {
      const drop = Math.floor(this.capacity / 2);
      let i = 0;
      for (const k of this.seen.keys()) {
        this.seen.delete(k);
        if (++i >= drop) break;
      }
    }
    this.seen.set(key, Date.now());
    return true;
  }
}

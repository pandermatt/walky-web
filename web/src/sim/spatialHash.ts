/**
 * Uniform grid over agent positions, rebuilt each tick by counting sort into flat
 * typed arrays.
 *
 * Replaces Map.getColosionPedestrian(), which scanned every pedestrian against
 * every other one. Cell size is set to the interaction diameter so a neighbour
 * query only ever touches the 3x3 block around an agent.
 */
export class SpatialHash {
  private cellSize = 1;
  private cols = 1;
  private rows = 1;
  private minX = 0;
  private minY = 0;
  /** Start of each cell's slice in `items`, length cols*rows + 1. */
  private cellStart = new Int32Array(2);
  private items = new Int32Array(0);
  private cursor = new Int32Array(1);

  /** Scratch buffer reused by query() so a lookup allocates nothing. */
  private results = new Int32Array(64);

  build(x: Float32Array, y: Float32Array, count: number, cellSize: number): void {
    this.cellSize = Math.max(1, cellSize);

    if (count === 0) {
      this.cols = this.rows = 1;
      this.minX = this.minY = 0;
      if (this.cellStart.length < 2) this.cellStart = new Int32Array(2);
      this.cellStart.fill(0);
      return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      if (x[i] < minX) minX = x[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i];
      if (y[i] > maxY) maxY = y[i];
    }
    this.minX = minX;
    this.minY = minY;
    this.cols = Math.max(1, Math.floor((maxX - minX) / this.cellSize) + 1);
    this.rows = Math.max(1, Math.floor((maxY - minY) / this.cellSize) + 1);

    const cellCount = this.cols * this.rows;
    if (this.cellStart.length < cellCount + 1) this.cellStart = new Int32Array(cellCount + 1);
    if (this.cursor.length < cellCount) this.cursor = new Int32Array(cellCount);
    if (this.items.length < count) this.items = new Int32Array(count);
    this.cellStart.fill(0, 0, cellCount + 1);

    // Counting sort: tally, prefix-sum, scatter.
    for (let i = 0; i < count; i++) this.cellStart[this.cellOf(x[i], y[i]) + 1]++;
    for (let c = 0; c < cellCount; c++) this.cellStart[c + 1] += this.cellStart[c];
    this.cursor.set(this.cellStart.subarray(0, cellCount));
    for (let i = 0; i < count; i++) this.items[this.cursor[this.cellOf(x[i], y[i])]++] = i;
  }

  /**
   * Indices within `radius` of (px, py), excluding `self`.
   * The returned view is scratch memory, valid only until the next query.
   */
  query(px: number, py: number, radius: number, self: number,
        x: Float32Array, y: Float32Array): Int32Array {
    let n = 0;
    const r2 = radius * radius;
    const reach = Math.max(1, Math.ceil(radius / this.cellSize));
    const cx = Math.floor((px - this.minX) / this.cellSize);
    const cy = Math.floor((py - this.minY) / this.cellSize);

    for (let gy = cy - reach; gy <= cy + reach; gy++) {
      if (gy < 0 || gy >= this.rows) continue;
      for (let gx = cx - reach; gx <= cx + reach; gx++) {
        if (gx < 0 || gx >= this.cols) continue;
        const cell = gy * this.cols + gx;
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
          const j = this.items[k];
          if (j === self) continue;
          const dx = x[j] - px;
          const dy = y[j] - py;
          if (dx * dx + dy * dy > r2) continue;
          if (n === this.results.length) {
            const grown = new Int32Array(this.results.length * 2);
            grown.set(this.results);
            this.results = grown;
          }
          this.results[n++] = j;
        }
      }
    }
    return this.results.subarray(0, n);
  }

  private cellOf(px: number, py: number): number {
    const gx = Math.min(this.cols - 1, Math.max(0, Math.floor((px - this.minX) / this.cellSize)));
    const gy = Math.min(this.rows - 1, Math.max(0, Math.floor((py - this.minY) / this.cellSize)));
    return gy * this.cols + gx;
  }
}

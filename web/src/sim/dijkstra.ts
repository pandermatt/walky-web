/**
 * Dijkstra over a static graph in compressed-sparse-row form, using a 4-ary heap
 * on flat typed arrays with lazy deletion.
 *
 * Replaces the original's DijkstraAlgorithm (a StackOverflow adaptation over
 * PriorityQueue<Node> with mutable node objects). Choices here:
 *
 *  - 4-ary rather than binary: a shallower tree means fewer cache misses on the
 *    sift-down, which dominates at these sizes.
 *  - Lazy deletion rather than decrease-key: push a duplicate when a node improves
 *    and skip stale pops. Avoids maintaining node->heap-position entirely.
 *  - Indices rather than objects: a run allocates nothing beyond its output.
 *
 * Fibonacci heaps have the better asymptotic bound and lose badly on constants at
 * every size this reaches.
 */

/** Graph in CSR form: neighbours of node i are [offsets[i], offsets[i+1]). */
export interface CsrGraph {
  nodeCount: number;
  offsets: Int32Array;
  targets: Int32Array;
  weights: Float32Array;
}

class QuadHeap {
  private nodes: Int32Array;
  private keys: Float32Array;
  private size = 0;

  constructor(capacity: number) {
    this.nodes = new Int32Array(capacity);
    this.keys = new Float32Array(capacity);
  }

  get length(): number { return this.size; }

  clear(): void { this.size = 0; }

  push(node: number, key: number): void {
    if (this.size === this.nodes.length) this.grow();
    let i = this.size++;
    this.nodes[i] = node;
    this.keys[i] = key;
    // Sift up.
    while (i > 0) {
      const parent = (i - 1) >> 2;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  /** Returns the node with the smallest key, or -1 when empty. */
  pop(): number {
    if (this.size === 0) return -1;
    const top = this.nodes[0];
    this.size--;
    if (this.size > 0) {
      this.nodes[0] = this.nodes[this.size];
      this.keys[0] = this.keys[this.size];
      this.siftDown(0);
    }
    return top;
  }

  peekKey(): number { return this.keys[0]; }

  private siftDown(start: number): void {
    let i = start;
    for (;;) {
      const first = 4 * i + 1;
      if (first >= this.size) break;
      // Pick the smallest of up to four children in one pass.
      let best = first;
      const last = Math.min(first + 4, this.size);
      for (let c = first + 1; c < last; c++) {
        if (this.keys[c] < this.keys[best]) best = c;
      }
      if (this.keys[i] <= this.keys[best]) break;
      this.swap(i, best);
      i = best;
    }
  }

  private swap(a: number, b: number): void {
    const n = this.nodes[a]; this.nodes[a] = this.nodes[b]; this.nodes[b] = n;
    const k = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = k;
  }

  private grow(): void {
    const nodes = new Int32Array(this.nodes.length * 2);
    const keys = new Float32Array(this.keys.length * 2);
    nodes.set(this.nodes); keys.set(this.keys);
    this.nodes = nodes; this.keys = keys;
  }
}

export interface DijkstraResult {
  /** Cost from the nearest source; Infinity where unreachable. */
  dist: Float32Array;
  /** Predecessor on the best path, or -1 at a source / unreachable node. */
  prev: Int32Array;
}

/**
 * Multi-source Dijkstra. Seeding every perimeter node of a goal at distance 0
 * makes one run answer "how far to this goal" for the whole graph, which is what
 * lets every agent share a single computation.
 */
export function dijkstra(graph: CsrGraph, sources: readonly number[]): DijkstraResult {
  const n = graph.nodeCount;
  const dist = new Float32Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const settled = new Uint8Array(n);
  const heap = new QuadHeap(Math.max(16, n));

  for (const s of sources) {
    if (s < 0 || s >= n) continue;
    if (dist[s] !== 0) { dist[s] = 0; heap.push(s, 0); }
  }

  while (heap.length > 0) {
    const key = heap.peekKey();
    const u = heap.pop();
    if (u < 0) break;
    // Lazy deletion: a stale duplicate is one whose key no longer matches.
    if (settled[u] || key > dist[u]) continue;
    settled[u] = 1;

    const start = graph.offsets[u];
    const end = graph.offsets[u + 1];
    for (let e = start; e < end; e++) {
      const v = graph.targets[e];
      if (settled[v]) continue;
      const cand = dist[u] + graph.weights[e];
      if (cand < dist[v]) {
        dist[v] = cand;
        prev[v] = u;
        heap.push(v, cand);
      }
    }
  }

  return { dist, prev };
}

/** Walks `prev` back from a node to its source, nearest-first. */
export function pathFrom(result: DijkstraResult, node: number): number[] {
  const out: number[] = [];
  for (let at = node; at !== -1; at = result.prev[at]) {
    out.push(at);
    if (out.length > result.prev.length) break; // defensive against a cycle
  }
  return out;
}

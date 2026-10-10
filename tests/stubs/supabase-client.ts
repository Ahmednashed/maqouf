// Stands in for `@/lib/supabase/client` in every test run — see
// tests/register.mjs. The real client is never loaded, so a test cannot reach
// a live database even by accident.
//
// The shape mirrors what the service layer actually uses: `from(table)` then a
// chain of `select` / `eq` / `order` / `single` that finally resolves. Each
// chain is thenable rather than returning a promise from `select`, because the
// services await the whole chain, not the first call.

export interface RecordedCall {
  table:   string;
  columns: string;
  /** `eq` filters applied, in order. */
  filters: Array<{ column: string; value: unknown }>;
  /** The options passed to `select`, e.g. `{ count: "exact" }`. */
  selectOptions?: unknown;
  /** Non-`eq` conditions (`gte`, `lte`, `gt`, `not`), in order. */
  conditions: Array<{ op: string; column: string; value: unknown; operator?: string }>;
  /** `order` calls, in order — the sort keys a read asked for. */
  orders: Array<{ column: string; ascending: boolean }>;
  /** The `limit` asked for, when there was one. */
  limit?: number;
  /** The abort signal attached with `abortSignal`, when there was one. */
  signal?: AbortSignal;
}

export interface StubResult {
  data:  unknown;
  error: unknown;
  /** PostgREST's exact count, when the read asked for one. */
  count?: number | null;
}

const calls: RecordedCall[] = [];
let queue: StubResult[] = [];
let tableQueues = new Map<string, StubResult[]>();
let fallback: StubResult = { data: [], error: null };

/** Every `from(...).select(...)` issued since the last reset, in order. */
export function recordedCalls(): readonly RecordedCall[] {
  return calls;
}

/** Result for the next query. Call once per expected query, in order. */
export function queueResult(result: StubResult): void {
  queue.push(result);
}

/**
 * Result for the next query against one table, whatever order the queries
 * resolve in. For services that issue several reads concurrently, where the
 * order they are awaited in is an implementation detail a test should not pin.
 * Takes precedence over `queueResult` for that table.
 */
export function queueResultFor(table: string, result: StubResult): void {
  const q = tableQueues.get(table) ?? [];
  q.push(result);
  tableQueues.set(table, q);
}

/** Result for any query beyond those queued. Defaults to an empty set. */
export function setDefaultResult(result: StubResult): void {
  fallback = result;
}

/** Clear recorded calls and queued results. Call at the top of each test. */
export function resetStub(): void {
  calls.length = 0;
  rpcs.length = 0;
  queue = [];
  tableQueues = new Map();
  fallback = { data: [], error: null };
}

function nextResult(table?: string): StubResult {
  const forTable = table === undefined ? undefined : tableQueues.get(table);
  if (forTable && forTable.length > 0) return forTable.shift()!;
  return queue.length > 0 ? queue.shift()! : fallback;
}

interface Chain extends PromiseLike<StubResult> {
  select(columns?: string, options?: unknown): Chain;
  eq(column: string, value: unknown): Chain;
  gte(column: string, value: unknown): Chain;
  lte(column: string, value: unknown): Chain;
  gt(column: string, value: unknown): Chain;
  not(column: string, operator: string, value: unknown): Chain;
  order(column: string, options?: { ascending?: boolean }): Chain;
  limit(n: number): Chain;
  abortSignal(signal: AbortSignal): Chain;
  single(): Chain;
  maybeSingle(): Chain;
  insert(values: unknown): Chain;
  update(values: unknown): Chain;
  delete(): Chain;
}

function chain(table: string): Chain {
  const call: RecordedCall = { table, columns: "", filters: [], conditions: [], orders: [] };
  let recorded = false;

  const self: Chain = {
    select(columns = "", options) {
      call.columns = columns;
      if (options !== undefined) call.selectOptions = options;
      if (!recorded) { calls.push(call); recorded = true; }
      return self;
    },
    eq(column, value) { call.filters.push({ column, value }); return self; },
    gte(column, value) { call.conditions.push({ op: "gte", column, value }); return self; },
    lte(column, value) { call.conditions.push({ op: "lte", column, value }); return self; },
    gt(column, value) { call.conditions.push({ op: "gt", column, value }); return self; },
    not(column, operator, value) { call.conditions.push({ op: "not", column, value, operator }); return self; },
    order(column, options) {
      // PostgREST's default is ascending.
      call.orders.push({ column, ascending: options?.ascending ?? true });
      return self;
    },
    limit(n) { call.limit = n; return self; },
    abortSignal(signal) { call.signal = signal; return self; },
    single() { return self; },
    maybeSingle() { return self; },
    insert() { if (!recorded) { calls.push(call); recorded = true; } return self; },
    update() { if (!recorded) { calls.push(call); recorded = true; } return self; },
    delete() { if (!recorded) { calls.push(call); recorded = true; } return self; },
    then(onFulfilled, onRejected) {
      return Promise.resolve(nextResult(table)).then(onFulfilled, onRejected);
    },
  };
  return self;
}

/** An `rpc(fn, args)` call, recorded the same way a table read is. */
export interface RecordedRpc {
  fn:   string;
  args: unknown;
}

const rpcs: RecordedRpc[] = [];

/** Every `rpc(...)` issued since the last reset, in order. */
export function recordedRpcs(): readonly RecordedRpc[] {
  return rpcs;
}

export function createClient() {
  return {
    from: (table: string) => chain(table),
    rpc(fn: string, args?: unknown) {
      rpcs.push({ fn, args });
      return Promise.resolve(nextResult());
    },
  };
}

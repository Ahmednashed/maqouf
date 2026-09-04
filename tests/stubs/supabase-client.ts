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
}

export interface StubResult {
  data:  unknown;
  error: unknown;
}

const calls: RecordedCall[] = [];
let queue: StubResult[] = [];
let fallback: StubResult = { data: [], error: null };

/** Every `from(...).select(...)` issued since the last reset, in order. */
export function recordedCalls(): readonly RecordedCall[] {
  return calls;
}

/** Result for the next query. Call once per expected query, in order. */
export function queueResult(result: StubResult): void {
  queue.push(result);
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
  fallback = { data: [], error: null };
}

function nextResult(): StubResult {
  return queue.length > 0 ? queue.shift()! : fallback;
}

interface Chain extends PromiseLike<StubResult> {
  select(columns?: string): Chain;
  eq(column: string, value: unknown): Chain;
  order(column: string, options?: unknown): Chain;
  limit(n: number): Chain;
  single(): Chain;
  maybeSingle(): Chain;
  insert(values: unknown): Chain;
  update(values: unknown): Chain;
  delete(): Chain;
}

function chain(table: string): Chain {
  const call: RecordedCall = { table, columns: "", filters: [] };
  let recorded = false;

  const self: Chain = {
    select(columns = "") {
      call.columns = columns;
      if (!recorded) { calls.push(call); recorded = true; }
      return self;
    },
    eq(column, value) { call.filters.push({ column, value }); return self; },
    order() { return self; },
    limit() { return self; },
    single() { return self; },
    maybeSingle() { return self; },
    insert() { if (!recorded) { calls.push(call); recorded = true; } return self; },
    update() { if (!recorded) { calls.push(call); recorded = true; } return self; },
    delete() { if (!recorded) { calls.push(call); recorded = true; } return self; },
    then(onFulfilled, onRejected) {
      return Promise.resolve(nextResult()).then(onFulfilled, onRejected);
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

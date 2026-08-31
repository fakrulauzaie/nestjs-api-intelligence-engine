# Non-Relational Resource Access

Analysis v7 preserves the v6 `cache-manager` and Redis `ResourceAccessRecord` facts. These facts
are separate from `InteractionRecord`: a cache command accesses a resource, while an
interaction represents communication or dispatch across a local or external boundary.

## Supported clients and operations

The extractor requires the TypeScript checker to resolve the called member to the
declared package. Calls are inventoried in package-proven Nest controllers,
`@Injectable()` providers, and BullMQ `@Processor()` providers. Same-named local
classes and arbitrary wrappers are ignored.

| Technology      | Supported direct APIs                                                  | Operation     |
| --------------- | ---------------------------------------------------------------------- | ------------- |
| `cache_manager` | `get`                                                                  | `read`        |
| `cache_manager` | `set`                                                                  | `write`       |
| `cache_manager` | `del`                                                                  | `delete`      |
| `cache_manager` | `wrap`                                                                 | `read_write`  |
| `ioredis`       | `get`, `exists`, `ttl`, `pttl`, `type`                                 | `read`        |
| `ioredis`       | `set`, `setex`, `psetex`, `incr`, `incrby`, `decr`, `decrby`, `append` | `write`       |
| `ioredis`       | `del`, `unlink`                                                        | `delete`      |
| `ioredis`       | `expire`, `pexpire`, `expireat`, `pexpireat`, `persist`                | `expire`      |
| `ioredis`       | `hget`, `hgetall`, `hexists`                                           | hash `read`   |
| `ioredis`       | `hset`, `hincrby`, `hincrbyfloat`                                      | hash `write`  |
| `ioredis`       | `hdel`                                                                 | hash `delete` |
| `ioredis`       | bounded `scan`, `hscan` with `MATCH`                                   | `scan`        |

Variadic `del` and `unlink` calls are expanded into one record per statically bounded
key, up to 16 keys. `scan` records the `MATCH` pattern as its keyspace target. `hscan`
records the hash key as its target and the `MATCH` field pattern as its selector.

## Structural targets and redaction

Resource targets use one of four forms:

- `exact`: a checker-resolved immutable string;
- `template`: bounded literal, symbolic, and positional-placeholder segments;
- `symbolic`: a supported structural token such as `this.cachePrefix` or a
  package-proven environment access; or
- `dynamic`: the key structure is outside the bounded resolver.

Only the key or selector structure is retained. Values passed to `set`/`hset`, cache
factory results, Redis payloads, credentials, and runtime environment values are never
stored in canonical evidence. Call evidence contains only the resolved callee; target
resolution evidence retains coordinates and hashes without copying target snippets.

## Derived consumers

`METHOD_ACCESSES_RESOURCE` assertions carry resource facts through direct call traces,
local event handlers, and distributed-conditional worker/message paths. Endpoint and
handler Markdown reports list the resource kind, operation, API, and causal class.
Comparison v5 treats a changed reachable resource set as the endpoint reason
`resource_accesses`; impact analysis then marks that exact endpoint slot without route
guessing. Graph v8 renders resource nodes in endpoint, handler, and architecture scenes
and includes them in resolved supported-root reach metrics.

## Explicit boundaries

Pipelines, transactions, Lua scripts, pub/sub, `keys`, stream helpers, arbitrary
wrappers, and unsupported clients are not expanded. Package-proven unsupported ioredis
commands emit `RESOURCE_ACCESS_OPERATION_UNSUPPORTED`. Dynamic or oversized targets
emit a structured diagnostic while preserving a bounded `dynamic` record when a
supported command itself is proven.

A resource fact does not prove command execution, success, cache hit/miss, key
existence, expiry timing, atomicity, lock semantics, network reachability, or a runtime
value. Package-proven Redlock scope is documented separately in
[Redlock Critical Sections](redlock-critical-sections.md); custom wrappers remain out of scope.

## Verification

The frozen `.ts.txt` corpus and focused test cover package identity, exact/template/
symbolic/dynamic targets, payload redaction, scans, unsupported APIs, endpoint and
handler traces, deterministic serialization, diff v5, Markdown, graph v8, and
architecture projection:

- `test/fixtures/resources/cache-and-redis.ts.txt`
- `test/unit/extractors/resource-access.test.ts`

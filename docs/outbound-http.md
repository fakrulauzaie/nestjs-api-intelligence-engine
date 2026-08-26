# Eager Outbound HTTP Analysis

Phase 31 adds evidence-backed `outbound_http` interaction records for a deliberately
small set of calls that initiate a request when the call expression is evaluated. The
extractor runs during every scan; it never sends a request, imports target modules,
executes configuration, or reads environment values.

## Supported clients and calls

The receiver must be proven by the TypeScript checker and its package declarations:

- Axios default imports and the named `axios` export;
- immutable local variables or `readonly` properties initialized directly by
  `axios.create(...)`;
- Axios `get`, `post`, `put`, `patch`, `delete`, `head`, `options`, `request`, and
  callable forms;
- an unshadowed standard global `fetch`; and
- the checker-proven `fetch` export from `undici`.

Same-named local objects, shadowed `fetch` parameters, arbitrary `AxiosInstance`
parameters, computed request methods, namespace-like lookalikes, and other HTTP
libraries do not become interactions. This Phase 31 extractor does not interpret Nest
`HttpService` as eager; Phase 32 models its cold RxJS semantics separately in
[Nest HttpService and Symbolic Targets](nest-http-service.md).

## Targets and methods

String literals and no-substitution templates produce `exact` targets. Bounded
template literals produce a normalized `template` target with numbered placeholders.
One directly initialized immutable string constant is followed. A supported literal
Axios `baseURL` is joined to a relative request path without invoking the WHATWG URL
implementation or any target code.

The extractor records the explicit supported HTTP method, or the documented `GET`
default for Axios/fetch forms without a method. A dynamic method becomes `UNKNOWN`.
A fully dynamic target becomes `{ "resolution": "dynamic", "value": null }`. These
calls are still proven request initiations; diagnostics describe only the unresolved
target or method.

Resource limits are intentionally fixed in this first extractor: 2,048 Unicode code
points per retained target, 20 template substitutions, and 100 query-key names. A
limit breach discards the target value and emits
`OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED`.

## Data-retention boundary

Canonical HTTP targets contain only:

- the normalized method;
- a sanitized URL/path structure; and
- sorted query-key names.

Query values, URL fragments, URL userinfo credentials, request bodies, header names
and values, cookies, and response data are not retained. Resolution-basis evidence
keeps coordinates but omits snippets. Declaration snippets stop at the class or method
body boundary, so a body/config/header value cannot re-enter canonical output through
generic declaration evidence.

## Uncertainty diagnostics

| Code                                  | Meaning                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `OUTBOUND_HTTP_TARGET_DYNAMIC`        | The call is proven, but its target is outside bounded static rules.             |
| `OUTBOUND_HTTP_METHOD_DYNAMIC`        | The call is proven, but its request method is dynamic or unsupported.           |
| `OUTBOUND_HTTP_CONFIG_UNSUPPORTED`    | Config uses a spread, computed key, unknown object flow, or transport override. |
| `OUTBOUND_HTTP_RECEIVER_UNSUPPORTED`  | The Axios method is package-proven, but its receiver binding is not.            |
| `OUTBOUND_HTTP_TARGET_LIMIT_EXCEEDED` | A target/template crossed a fixed extraction limit and was discarded.           |
| `OUTBOUND_HTTP_ACTIVATION_UNKNOWN`    | A cold producer crosses an unsupported activation boundary.                     |

Any such gap makes `interactionAnalysis.state` incomplete and normally contributes to
`completed_with_gaps`; it does not erase other trusted facts.

## Derived views

Endpoint traces and catalogues include outbound interactions reachable through the
existing bounded direct-call graph. Uncalled helpers remain canonical method facts but
do not appear in an endpoint scene. The configured method call-depth limit therefore
also bounds endpoint-to-HTTP reachability.

Semantic comparison projection includes method, kind, sanitized target, activation,
boundary, timing, and application identity. Diff schema `2.0.0` publishes explicit
interaction add/remove/modify states, and impact reports attach those changes to
endpoint-reachable interaction paths. Control/OpenAPI schema `2.0.0` exposes outbound
summaries separately from database effects. Current analysis v3 graphs use
`GraphReportDocument` schema `3.0.0`, with separate producer, boundary, and external
target nodes; historical graph `2.0.0` remains readable.

## Deliberate boundaries

- The eager extractor performs no RxJS activation analysis; Phase 32 owns supported
  Nest `HttpService` calls. `got`, arbitrary client wrappers, SDK-specific calls, and
  response lineage remain unsupported.
- No runtime URL parsing, DNS, network access, environment lookup, or config execution.
- No generic inference from method names such as `get`, `post`, or `request`.
- No claim that an external service received, handled, or successfully completed the
  request.

The executable contract is
`test/unit/extractors/outbound-http.test.ts`, backed by the non-executable fixture and
semantic manifest under `test/fixtures/interactions/`.

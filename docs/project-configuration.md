# Project Configuration

`api-intel scan` supports one strict JSON configuration language. It does not execute
JavaScript or TypeScript, interpolate environment variables, search parent directories,
or resolve the editor-only `$schema` value.

## Version 4

Version 4 adds strict authorization discovery configuration to the version-3 project
configuration contract:

```json
{
  "$schema": "./schemas/api-intel.config.schema.json",
  "version": 4,
  "analysis": {
    "maxCallDepth": 3,
    "rawSqlDialect": "postgresql-18",
    "interactions": {
      "maxInteractionHops": 2,
      "maxFanOutPerInteraction": 50,
      "maxInteractionTraceStates": 1000
    },
    "authorization": {
      "metadataKeys": ["roles"],
      "decoratorSymbols": [
        {
          "symbol": {
            "kind": "package_export",
            "moduleSpecifier": "@acme/auth",
            "exportedName": "Permission"
          },
          "metadataKey": "permissions"
        }
      ],
      "enforcementRelationships": [
        {
          "metadataKey": "roles",
          "guard": {
            "kind": "repository_export",
            "sourceFile": "src/auth/auth.guard.ts",
            "exportedName": "AuthGuard"
          }
        }
      ]
    }
  },
  "output": {
    "directory": ".api-intel"
  }
}
```

All three interaction limits are optional when `interactions` is present and use the
documented defaults above when omitted. They bound configured in-process event,
BullMQ, and Nest microservice causal traversal; they do not enable or disable an extractor. Analysis v3 can
represent four interaction kinds, while capability metadata separately reports which
kinds the running analyzer actually supports. The current scanner always enables
all four kinds: `outbound_http`, `in_process_event`, `job_queue`, and
`microservice_message`. Configuration cannot disable a supported extractor. Symbolic
tokens are derived only from source identity, never project
configuration values or environment lookup.

All authorization arrays are optional and default to empty. `metadataKeys` enables
direct or wrapped `SetMetadata()` extraction for exact keys. `decoratorSymbols` must
identify a package export by module/export name or a repository export by normalized
source path/export name, then assign its metadata key. `enforcementRelationships`
must identify an exact repository guard export. Bare decorator or guard names are
rejected because same-named declarations are not reliable identities.

Configuration never upgrades a relationship to package proof. A configured mapping
is emitted as `configured_relationship`; only a statically exact
`applyDecorators(SetMetadata(...), UseGuards(...))` composition is
`proven_enforced`. Values are represented structurally and redacted.

## Version 3 compatibility

Version 3 retains the same interaction traversal contract without the authorization
category. Its meaning is unchanged.

## Version 2 compatibility

```json
{
  "$schema": "./schemas/api-intel.config.schema.json",
  "version": 2,
  "analysis": {
    "maxCallDepth": 3,
    "rawSqlDialect": "postgresql-18"
  },
  "output": {
    "directory": ".api-intel"
  },
  "rules": {
    "require-guard-on-write-endpoint": "error"
  },
  "reports": {
    "policy": {
      "enabled": true
    },
    "graph": {
      "enabled": true,
      "maxNodesPerEndpoint": 120,
      "maxEdgesPerEndpoint": 180
    },
    "controls": {
      "enabled": true
    },
    "openapi": {
      "enabled": true,
      "document": "./openapi.json",
      "pathPrefix": "/api",
      "includeEvidence": false
    }
  }
}
```

Every category is optional, but every supplied category is strict. Unknown keys, rule
IDs, dialects, versions, and out-of-range values fail before source analysis. Graph
limits are 10-500 nodes and 10-1,000 edges per endpoint. The bundled schema is
[`schemas/api-intel.config.schema.json`](../schemas/api-intel.config.schema.json) and is
generated from the same Zod contract used at runtime.

An enabled policy recipe requires a non-empty `rules` category. Controls and graph can
be enabled independently; when policy is also enabled, both consume the same in-memory
policy result. An enabled OpenAPI recipe requires an explicit JSON document path,
resolved from the config file directory. `pathPrefix` and `includeEvidence` have the
same meaning as their standalone command options. `{ "enabled": false }` is the strict
disabled OpenAPI form. There is no `all` recipe and no stored browser-preview setting.

## Discovery and selection

```text
pnpm run cli -- scan <repository>
pnpm run cli -- scan <repository> --config <path>
pnpm run cli -- scan <repository> --no-config
```

The default lookup checks exactly `<repository>/api-intel.config.json`. It never walks
to a parent. `--config` resolves from the invocation's current directory and selects
that exact file. `--no-config` suppresses lookup. Supplying both is a usage error.

An output path in a config resolves from the config file's directory. Auto-discovered
configuration cannot escape the analyzed repository. An explicitly selected config may
locate output elsewhere, and an explicit CLI `--output` may always do so. Empty,
whitespace-only, and null-containing configured paths are invalid.

`$schema` is inert editor metadata. It may be a local-looking path or URL; the CLI does
not read, resolve, or fetch it.

## Precedence

Effective values are selected in this order:

1. An explicit CLI value.
2. The selected version-2, version-3, or version-4 configuration value.
3. The built-in default.

This applies to maximum call depth, interaction traversal limits, raw-SQL dialect,
output directory, report selection, OpenAPI document, and graph display limits.
`--with-graph`, `--with-controls`, and
`--with-openapi <document>` explicitly enable those reports even if no recipe is
configured. `--max-nodes`, `--max-edges`, and `--open` require an effective graph.
`--open` is never read from configuration and runs only after successful graph
publication. Invalid CLI values remain errors; the loader never silently falls back to
a valid config value.

The current raw-SQL contract supports one dialect (`postgresql-18`), so a valid CLI
dialect override is semantically equivalent to that configured value. Any other
explicit value still fails rather than falling back.

## Version 1 migration

Existing version-1 policy-only files remain valid:

```json
{
  "version": 1,
  "rules": {
    "no-repository-access-in-controller": "error"
  }
}
```

`check` evaluates every supported version. For versions 2-4, `rules` must be present when invoking
`check`; unrelated categories cannot retroactively alter the supplied analysis.
`scan` tolerates a discovered version-1 file and records its normalized rules, but it
has no version-1 analysis, output, or report defaults to apply.

Migration therefore requires changing `version` to `2` when adding the version-2
categories, to `3` when adding interaction traversal limits, or to `4` when adding
authorization configuration. Older files remain valid and retain their original
meaning. Rule syntax and normalization are shared rather than duplicated.

## Outputs and identity

For CLI scans, `run.json.projectConfiguration` records:

- whether config was absent, discovered, or explicit, with its absolute path/version;
- effective analysis values;
- the resolved output directory;
- normalized rules in stable rule-ID order; and
- effective policy, graph, controls, and OpenAPI selections and their options.

`analysis.maxCallDepth`, the enabled raw-SQL parser configuration, configured
interaction traversal limits, and authorization discovery configuration enter
`analysis.json` and its analysis-run ID. Changing
output, rules, report enablement, OpenAPI inputs, or graph display limits does not
change canonical facts or identity. Configured derived reports are built from the same
in-memory validated analysis and are byte-identical to their standalone commands with
equivalent inputs.

In short, presentation configuration does not change canonical facts or identity.

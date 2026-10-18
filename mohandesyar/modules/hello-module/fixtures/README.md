# hello-module test fixtures

Overlays applied on top of the module source by the integration tests to build package variants:

| fixture | purpose |
|---|---|
| `v1.1.0` | upgrade with an *expand* migration (adds `pinned`), then rollback to 1.0.0 |
| `bad-migration` | migration that fails half-way → whole install must roll back |
| `no-rls` | table with `tenant_id` but no RLS → post-migration check must refuse |
| `bad-code` | backend throws at import → dry-load must refuse before touching the database |

`manifest.patch.json` is shallow-merged into `module.manifest.json`; other files are copied over the source.

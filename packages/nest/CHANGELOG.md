# Changelog

## 0.1.0 (2026-07-12)

- Initial release: `I18nAgentModule.forRoot({ bundleDir, route, cacheControl })` — serves an `i18n-agent export --bundle` directory from your own NestJS backend: manifest route + all bundle files, per-file ETags from the manifest, `If-None-Match` → 304, manifest-allowlisted paths only (traversal-proof), auto-reload on in-place regeneration.

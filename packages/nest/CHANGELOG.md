# Changelog

## 0.1.2 (2026-07-13)

- Depend on `i18n-agent@^0.4.0` (BundleReader in-memory hot path from 0.3.2 + TS-module locale layout from 0.4.0).

## 0.1.1 (2026-07-12)

- Fastify support: 0.1.0 assumed the Express adapter (`res.setHeader`) and crashed on `@nestjs/platform-fastify`. Routes are now registered directly on the HTTP adapter once it is known (`HttpAdapterHost`, the `@nestjs/serve-static` approach) — a mount-path middleware on Express, a native `*` wildcard on find-my-way for Fastify — with adapter-agnostic header writing. Behavior change: the bundle mounts at the app root; global prefixes, guards, and interceptors no longer apply to its routes. New peer dependency: `@nestjs/core`. Test suite runs against both adapters.

- Initial release: `I18nAgentModule.forRoot({ bundleDir, route, cacheControl })` — serves an `i18n-agent export --bundle` directory from your own NestJS backend: manifest route + all bundle files, per-file ETags from the manifest, `If-None-Match` → 304, manifest-allowlisted paths only (traversal-proof), auto-reload on in-place regeneration.

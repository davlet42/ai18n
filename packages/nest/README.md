# i18n-agent-nest

Serve [i18n-agent](https://github.com/davlet42/ai18n) translation bundles from **your own NestJS backend** — self-hosted delivery with ETag caching. No third-party cloud, no per-request fees: the bundle is static files in your deploy, your server is the only server involved.

```bash
npm i i18n-agent-nest
```

```ts
import { I18nAgentModule } from 'i18n-agent-nest';

@Module({
  imports: [
    I18nAgentModule.forRoot({
      bundleDir: join(__dirname, '..', 'i18n-bundle'), // produced by `i18n-agent export --bundle`
      route: 'i18n',                                   // default
      // cacheControl: 'public, max-age=60, stale-while-revalidate=600',
    }),
  ],
})
export class AppModule {}
```

Regenerate the bundle on deploy (or whenever translations change):

```bash
i18n-agent translate && i18n-agent export --bundle
```

## What gets served

| Route | Content |
|---|---|
| `GET /i18n/manifest.json` | bundle etag, languages, per-file sha256 |
| `GET /i18n/web/<lang>/<ns>.json` | web locales (runtime fetch) |
| `GET /i18n/android/res/values-<lang>/strings.xml` | Android resources (CI fetch at build) |
| `GET /i18n/ios/Localizable.xcstrings` | iOS String Catalog (CI fetch at build) |
| `GET /i18n/ts/i18n-keys.d.ts` | generated key types |

- Every response carries an **ETag** (content hash from the manifest); `If-None-Match` → **304**.
- Only manifest-listed paths are served — path traversal is structurally impossible.
- Regenerating the bundle in place is picked up automatically (manifest mtime watch).
- Express adapter (Nest default). Not on Nest? The bundle is plain static files — `express.static`, nginx `root`, or an S3 bucket work just as well; this module only adds correct ETags and a manifest route on top.

MIT

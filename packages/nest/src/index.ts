import { Controller, Get, Module, Param, Req, Res, type DynamicModule } from '@nestjs/common';
import { BundleReader } from 'i18n-agent';

// Self-hosted translation delivery for NestJS: mount an i18n-agent bundle
// (produced by `i18n-agent export --bundle`) behind a route of YOUR backend.
// Clients — web at runtime, mobile CI at build time — fetch:
//
//   GET <route>/manifest.json          bundle etag, languages, file hashes
//   GET <route>/web/ru/common.json     any manifest-listed file
//   GET <route>/android/res/values-ru/strings.xml
//
// Every response carries an ETag (per-file content hash from the manifest);
// If-None-Match yields 304. Regenerating the bundle in place is picked up
// automatically (the reader reloads the manifest on mtime change). Only
// manifest-listed paths are served — path traversal is structurally
// impossible. Express adapter (Nest default) is assumed.

export interface I18nAgentModuleOptions {
  /** Directory produced by `i18n-agent export --bundle`. */
  bundleDir: string;
  /** Route prefix, default "i18n". */
  route?: string;
  /** Cache-Control header, default "public, max-age=60, stale-while-revalidate=600". */
  cacheControl?: string;
}

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.xcstrings': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
};

function contentTypeFor(rel: string): string {
  for (const [ext, type] of Object.entries(CONTENT_TYPES)) {
    if (rel.endsWith(ext)) {
      return type;
    }
  }
  return 'application/octet-stream';
}

interface MinimalResponse {
  setHeader(name: string, value: string): void;
  status(code: number): { send(body?: unknown): void };
}

interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
}

export class I18nAgentModule {
  static forRoot(options: I18nAgentModuleOptions): DynamicModule {
    const reader = new BundleReader(options.bundleDir);
    const cacheControl = options.cacheControl ?? 'public, max-age=60, stale-while-revalidate=600';

    const respond = (
      req: MinimalRequest,
      res: MinimalResponse,
      etag: string,
      contentType: string,
      body: () => unknown,
    ): void => {
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', cacheControl);
      if (req.headers['if-none-match'] === etag) {
        res.status(304).send();
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.status(200).send(body());
    };

    @Controller(options.route ?? 'i18n')
    class I18nAgentController {
      @Get('manifest.json')
      manifest(@Req() req: MinimalRequest, @Res() res: MinimalResponse): void {
        const manifest = reader.manifest();
        if (!manifest) {
          res.status(404).send({ error: 'bundle not found — run `i18n-agent export --bundle`' });
          return;
        }
        respond(req, res, `"${manifest.etag}"`, 'application/json; charset=utf-8', () =>
          JSON.stringify(manifest),
        );
      }

      @Get('*rest')
      file(@Param('rest') rest: string | string[], @Req() req: MinimalRequest, @Res() res: MinimalResponse): void {
        const rel = Array.isArray(rest) ? rest.join('/') : rest;
        const hit = reader.read(rel);
        if (!hit) {
          res.status(404).send({ error: 'not in bundle', path: rel });
          return;
        }
        respond(req, res, hit.etag, contentTypeFor(rel), () => hit.content);
      }
    }

    return {
      module: I18nAgentModule,
      controllers: [I18nAgentController],
    };
  }
}

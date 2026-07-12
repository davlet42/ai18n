import { Inject, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
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
// impossible.
//
// Works on both Nest HTTP adapters, Express and Fastify. Their routers have
// no common wildcard syntax (path-to-regexp wants `*name`, find-my-way wants
// a trailing `*`), so routes are registered directly on the adapter once it
// is known (same approach as @nestjs/serve-static) rather than through a
// controller. Consequence: the bundle mounts at the app root — global
// prefixes, guards, and interceptors do not apply.

export interface I18nAgentModuleOptions {
  /** Directory produced by `i18n-agent export --bundle`. */
  bundleDir: string;
  /** Route prefix, default "i18n". */
  route?: string;
  /** Cache-Control header, default "public, max-age=60, stale-while-revalidate=600". */
  cacheControl?: string;
}

export const I18N_AGENT_OPTIONS = 'I18N_AGENT_OPTIONS';

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

// Duck types covering both adapters' request/reply objects: Express exposes
// setHeader (node's ServerResponse), Fastify only header.
interface MinimalRequest {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  params?: Record<string, unknown>;
}

interface MinimalResponse {
  setHeader?(name: string, value: string): unknown;
  header?(name: string, value: string): unknown;
  status(code: number): { send(body?: unknown): void };
}

interface MinimalHttpInstance {
  get(path: string, handler: (req: MinimalRequest, res: MinimalResponse) => void): unknown;
  use(path: string, handler: (req: MinimalRequest, res: MinimalResponse, next: () => void) => void): unknown;
}

function writeHeader(res: MinimalResponse, name: string, value: string): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
    return;
  }
  if (typeof res.header === 'function') {
    res.header(name, value);
    return;
  }
  throw new TypeError('i18n-agent-nest: response object exposes neither setHeader (Express) nor header (Fastify)');
}

function decodeRel(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return ''; // malformed escapes cannot name a manifest-listed file
  }
}

@Module({})
export class I18nAgentModule implements OnModuleInit {
  static forRoot(options: I18nAgentModuleOptions): DynamicModule {
    return {
      module: I18nAgentModule,
      providers: [{ provide: I18N_AGENT_OPTIONS, useValue: options }],
    };
  }

  constructor(
    @Inject(I18N_AGENT_OPTIONS) private readonly options: I18nAgentModuleOptions,
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  onModuleInit(): void {
    const adapter = this.adapterHost.httpAdapter;
    if (!adapter) {
      return; // non-HTTP context (e.g. a microservice)
    }

    const reader = new BundleReader(this.options.bundleDir);
    const cacheControl = this.options.cacheControl ?? 'public, max-age=60, stale-while-revalidate=600';
    const prefix = `/${(this.options.route ?? 'i18n').replace(/^\/+|\/+$/g, '')}`;

    const respond = (
      req: MinimalRequest,
      res: MinimalResponse,
      etag: string,
      contentType: string,
      body: () => unknown,
    ): void => {
      writeHeader(res, 'ETag', etag);
      writeHeader(res, 'Cache-Control', cacheControl);
      if (req.headers['if-none-match'] === etag) {
        res.status(304).send();
        return;
      }
      writeHeader(res, 'Content-Type', contentType);
      res.status(200).send(body());
    };

    const handle = (rel: string, req: MinimalRequest, res: MinimalResponse): void => {
      if (rel === 'manifest.json') {
        const manifest = reader.manifest();
        if (!manifest) {
          res.status(404).send({ error: 'bundle not found — run `i18n-agent export --bundle`' });
          return;
        }
        respond(req, res, `"${manifest.etag}"`, 'application/json; charset=utf-8', () =>
          JSON.stringify(manifest),
        );
        return;
      }
      const hit = reader.read(rel);
      if (!hit) {
        res.status(404).send({ error: 'not in bundle', path: rel });
        return;
      }
      respond(req, res, hit.etag, contentTypeFor(rel), () => hit.content);
    };

    const instance = adapter.getInstance() as MinimalHttpInstance;
    if (adapter.getType() === 'fastify') {
      // find-my-way decodes the captured tail itself.
      instance.get(`${prefix}/*`, (req, res) => {
        const tail = req.params?.['*'];
        handle(typeof tail === 'string' ? tail : '', req, res);
      });
      return;
    }
    // Express (default adapter): a mount-path middleware sidesteps wildcard
    // syntax entirely; req.url arrives stripped of the prefix.
    instance.use(prefix, (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      const rel = decodeRel((req.url ?? '/').split('?')[0].replace(/^\/+/, ''));
      handle(rel, req, res);
    });
  }
}

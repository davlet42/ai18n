const ANNOTATION_BLOCK_RE = /<annotation\b([^>]*)>([\s\S]*?)<\/annotation>/g;
const ANNOTATION_TAG_RE = /<annotation\b[^>]*>|<\/annotation>/g;
const ANNOTATION_SEGMENT_RE = /(<annotation\b[^>]*>|<\/annotation>)/g;
const ANNOTATION_MASK_MARKER_RE = /⟦\d+⟧/;

export function hasAndroidAnnotationMarkup(text: string): boolean {
  return text.includes('<annotation');
}

export function extractAnnotationTags(text: string): string[] {
  return [...text.matchAll(ANNOTATION_TAG_RE)].map((match) => match[0]).sort();
}

export interface AndroidMarkupMask {
  masked: string;
  original: string;
}

export function maskAndroidMarkup(text: string): AndroidMarkupMask {
  let index = 0;
  const masked = text.replace(ANNOTATION_BLOCK_RE, (_full, attrs: string) => {
    const marker = `⟦${index}⟧`;
    index += 1;
    return `<annotation${attrs}>${marker}</annotation>`;
  });
  return { masked, original: text };
}

export function hasAnnotationMaskMarkers(text: string): boolean {
  return ANNOTATION_MASK_MARKER_RE.test(text);
}

/** @deprecated Markers must be translated away; kept for API compatibility. */
export function unmaskAndroidMarkup(translated: string): string {
  return translated;
}

export function validateAnnotationMaskMarkers(target: string): string[] {
  if (!hasAnnotationMaskMarkers(target)) {
    return [];
  }
  return ['annotation mask markers leaked (⟦n⟧) — inner text was not translated'];
}

function multisetDiff(want: string[], got: string[]): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const pool = [...got];
  for (const token of want) {
    const idx = pool.indexOf(token);
    if (idx === -1) {
      missing.push(token);
    } else {
      pool.splice(idx, 1);
    }
  }
  return { missing, extra: pool };
}

export function validateAndroidMarkup(source: string, target: string): string[] {
  const want = extractAnnotationTags(source);
  if (want.length === 0) {
    return [];
  }
  const got = extractAnnotationTags(target);
  const { missing, extra } = multisetDiff(want, got);
  const issues: string[] = [];
  if (missing.length > 0) {
    issues.push(`missing annotation tags: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    issues.push(`extra annotation tags: ${extra.join(', ')}`);
  }
  return issues;
}

function escapeAndroidPlain(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/** Escape Android string resources but preserve inline <annotation> markup verbatim. */
export function escapeAndroidForResources(text: string): string {
  const parts = text.split(ANNOTATION_SEGMENT_RE);
  return parts
    .map((part) => {
      if (part.match(/^<annotation\b[^>]*>$/) || part === '</annotation>') {
        return part;
      }
      return escapeAndroidPlain(part);
    })
    .join('');
}

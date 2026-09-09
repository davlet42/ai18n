const ANNOTATION_TAG_RE = /<annotation\b[^>]*>|<\/annotation>/g;

export function extractAnnotationTags(text: string): string[] {
  return [...text.matchAll(ANNOTATION_TAG_RE)].map((match) => match[0]).sort();
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

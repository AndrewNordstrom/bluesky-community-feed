import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  collectSchemaEnumValues,
  collectTopLevelHeadings,
  filesHaveIdenticalBytes,
  findHeadingLineIndex,
  findNextTopLevelHeadingIndex,
  hasExactSchemaEnumValues,
  hasExpectedHealthRevisionSchema,
  isCanonicalApacheLicense,
  isMarkdownSeparatorRow,
  readJson,
  validateOpenApiOperations,
} from '../scripts/verify-docs.mjs';

describe('verify-docs helpers', () => {
  it('compares inline schema enums independent of member order', () => {
    const schema = {
      properties: {
        status: { enum: ['ok', 'degraded'] },
      },
    };

    expect(collectSchemaEnumValues(schema, {}, new Set())).toEqual(['degraded', 'ok']);
  });

  it('resolves status enums through local refs and composed schemas', () => {
    const spec = {
      components: {
        schemas: {
          Status: { enum: ['ready'] },
        },
      },
    };
    const schema = {
      allOf: [
        {
          properties: {
            status: { $ref: '#/components/schemas/Status' },
          },
        },
      ],
    };

    expect(collectSchemaEnumValues(schema, spec, new Set())).toEqual(['ready']);
  });

  it('intersects constrained allOf enums without narrowing on unconstrained branches', () => {
    const schema = {
      allOf: [
        { properties: { status: { enum: ['ok', 'degraded'] } } },
        {},
        { properties: { status: { enum: ['ok'] } } },
      ],
    };

    expect(collectSchemaEnumValues(schema, {}, new Set())).toEqual(['ok']);
  });

  it('rejects an invalid reference inside allOf instead of discarding it', () => {
    const schema = {
      properties: { status: { enum: ['ok'] } },
      allOf: [{ $ref: '#/components/schemas/Missing' }],
    };

    expect(collectSchemaEnumValues(schema, {}, new Set())).toBeNull();
    expect(hasExactSchemaEnumValues(schema, {}, ['ok'])).toBe(false);
  });

  it.each(['anyOf', 'oneOf'])('rejects an indeterminate %s status union', (keyword) => {
    const schema = {
      [keyword]: [
        { properties: { status: { enum: ['ok'] } } },
        { properties: { status: {} } },
      ],
    };

    expect(collectSchemaEnumValues(schema, {}, new Set())).toBeNull();
    expect(hasExactSchemaEnumValues(schema, {}, ['ok'])).toBe(false);
  });

  it.each(['anyOf', 'oneOf'])('rejects an invalid reference inside %s', (keyword) => {
    const schema = {
      properties: { status: { enum: ['ok'] } },
      [keyword]: [{ $ref: '#/components/schemas/Missing' }],
    };

    expect(collectSchemaEnumValues(schema, {}, new Set())).toBeNull();
    expect(hasExactSchemaEnumValues(schema, {}, ['ok'])).toBe(false);
  });

  it('reports an eligible full operation missing from the public specification', () => {
    const fullSpec = {
      paths: {
        '/health': {
          get: { tags: ['Health'], responses: {} },
        },
      },
    };
    const publicSpec = { paths: {} };
    const problems: string[] = [];

    validateOpenApiOperations(fullSpec, publicSpec, problems);

    expect(problems).toContain('OpenAPI drift: public specification is missing GET /health');
  });

  it('reports inherited path parameters missing from the public specification', () => {
    const fullSpec = {
      paths: {
        '/health': {
          parameters: [{ in: 'header', name: 'x-request-id', required: true, schema: { type: 'string' } }],
          get: { tags: ['Health'], responses: {} },
        },
      },
    };
    const publicSpec = {
      paths: {
        '/health': {
          get: { tags: ['Health'], responses: {} },
        },
      },
    };
    const problems: string[] = [];

    validateOpenApiOperations(fullSpec, publicSpec, problems);

    expect(problems).toContain(
      'OpenAPI drift: public path parameters for /health differ from full specification',
    );
  });

  it.each([
    ['missing revision', { type: 'object', properties: {}, required: [] }],
    ['non-nullable revision', {
      type: 'object',
      properties: { revision: { type: 'string', pattern: '^[0-9a-f]{40}$' } },
      required: ['revision'],
    }],
    ['invalid revision constraint', {
      type: 'object',
      properties: { revision: { type: 'string', nullable: true, pattern: '^[0-9a-f]+$' } },
      required: ['revision'],
    }],
    ['minimum length excluding a full SHA', {
      type: 'object',
      properties: {
        revision: { type: 'string', nullable: true, pattern: '^[0-9a-f]{40}$', minLength: 41 },
      },
      required: ['revision'],
    }],
    ['maximum length excluding a full SHA', {
      type: 'object',
      properties: {
        revision: { type: 'string', nullable: true, pattern: '^[0-9a-f]{40}$', maxLength: 39 },
      },
      required: ['revision'],
    }],
  ])('rejects a health schema with %s', (_name, schema) => {
    expect(hasExpectedHealthRevisionSchema(schema)).toBe(false);
  });

  it.each([
    ['minimum', { minLength: 40 }],
    ['maximum', { maxLength: 40 }],
  ])('accepts the required nullable full-SHA health revision contract at the exact %s bound', (
    _name,
    lengthConstraint,
  ) => {
    const schema = {
      type: 'object',
      properties: {
        revision: {
          type: 'string',
          nullable: true,
          pattern: '^[0-9a-f]{40}$',
          ...lengthConstraint,
        },
      },
      required: ['revision'],
    };

    expect(hasExpectedHealthRevisionSchema(schema)).toBe(true);
  });

  it('handles missing, unresolved, cyclic, and escaped local refs', () => {
    const spec = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
          'Status/With~Token': { enum: ['ready'] },
        },
      },
    };

    expect(collectSchemaEnumValues(null, spec, new Set())).toEqual([]);
    expect(
      collectSchemaEnumValues({ $ref: '#/components/schemas/Missing' }, spec, new Set()),
    ).toBeNull();
    expect(
      collectSchemaEnumValues({ $ref: '#/components/schemas/A' }, spec, new Set()),
    ).toBeNull();
    expect(
      collectSchemaEnumValues(
        { $ref: '#/components/schemas/Status~1With~0Token' },
        spec,
        new Set(),
      ),
    ).toEqual(['ready']);
  });

  it('returns an empty list when no top-level headings exist', () => {
    expect(collectTopLevelHeadings('')).toEqual([]);
  });

  it('ignores top-level headings inside fenced code blocks', () => {
    const content = [
      '## 1. What This Repo Is',
      '',
      '```bash',
      '## fake heading',
      '```',
      '',
      '## 2. Why It Exists',
    ].join('\n');

    expect(collectTopLevelHeadings(content)).toEqual([
      '## 1. What This Repo Is',
      '## 2. Why It Exists',
    ]);
  });

  it('finds the next real top-level heading after a tracker subsection', () => {
    const lines = [
      '### Doc Compliance Tracker (production_service)',
      '| Required Doc | Canonical Path | Status | Notes |',
      '|--------------|----------------|--------|-------|',
      '| readme | `README.md` | Exists | Canonical entry point |',
      '```md',
      '## fake heading',
      '```',
      '## 8. Known Gotchas',
    ];

    expect(findNextTopLevelHeadingIndex(lines, 1)).toBe(7);
  });

  it('returns -1 when no real top-level heading exists after the start index', () => {
    const lines = ['plain text', '```md', '## fake heading', '```'];
    expect(findNextTopLevelHeadingIndex(lines, 0)).toBe(-1);
    expect(findNextTopLevelHeadingIndex(lines, 2)).toBe(-1);
  });

  it('finds only actual tracker heading lines, not prose or fenced code', () => {
    const lines = [
      'This paragraph mentions ### Doc Compliance Tracker in prose.',
      '```md',
      '### Doc Compliance Tracker (production_service)',
      '```',
      '### Doc Compliance Tracker (production_service)',
    ];

    expect(findHeadingLineIndex(lines, /^###\s+Doc Compliance Tracker\b/)).toBe(4);
  });

  it('accepts only valid markdown separator rows', () => {
    expect(
      isMarkdownSeparatorRow(['--------------', '----------------', '--------', '-------'], 4),
    ).toBe(true);
    expect(
      isMarkdownSeparatorRow(['Required Doc', 'Canonical Path', 'Status', 'Notes'], 4),
    ).toBe(false);
    expect(isMarkdownSeparatorRow(['--------------', '----------------', '--------'], 4)).toBe(
      false,
    );
    expect(
      isMarkdownSeparatorRow(['--------------', '---x---', '--------', '-------'], 4),
    ).toBe(false);
  });

  it.each([
    ['section 2', 'copyright license to reproduce', 'copyright license to inspect'],
    ['section 3', 'patent license to make', 'patent license to inspect'],
    ['section 4', 'You may reproduce and distribute copies', 'You may inspect and distribute copies'],
    ['section 7', 'WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND', 'WITHOUT WARRANTIES OF ANY KIND'],
    ['section 8', 'In no event and under no legal theory', 'In an event and under no legal theory'],
  ])('rejects altered Apache-2.0 terms in %s', (_section, original, replacement) => {
    const canonicalLicense = readFileSync(path.resolve('LICENSE'), 'utf8');
    expect(canonicalLicense).toContain(original);
    expect(isCanonicalApacheLicense(canonicalLicense.replace(original, replacement))).toBe(false);
  });

  it.each([
    ['manifest malformed JSON', 'package.json', '{'],
    ['manifest JSON null', 'package.json', 'null'],
    ['OpenAPI malformed JSON', 'openapi.json', '{'],
    ['OpenAPI JSON null', 'openapi.json', 'null'],
  ])('records %s as a verification problem', (_name, filename, content) => {
    const root = mkdtempSync(path.join(tmpdir(), 'corgi-verify-docs-'));
    const filePath = path.join(root, filename);
    try {
      writeFileSync(filePath, content);
      const problems: string[] = [];
      expect(readJson(filePath, problems)).toBeNull();
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(filename);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats whitespace-only JSON differences as artifact byte drift', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'corgi-openapi-bytes-'));
    const publicPath = path.join(root, 'public.json');
    const sitePath = path.join(root, 'site.json');
    try {
      writeFileSync(publicPath, '{"openapi":"3.0.0"}\n');
      writeFileSync(sitePath, '{\n  "openapi": "3.0.0"\n}\n');
      expect(filesHaveIdenticalBytes(publicPath, sitePath)).toBe(false);
      writeFileSync(sitePath, '{"openapi":"3.0.0"}\n');
      expect(filesHaveIdenticalBytes(publicPath, sitePath)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('packs both LICENSE and NOTICE in the feed SDK archive', () => {
    const cache = mkdtempSync(path.join(tmpdir(), 'corgi-sdk-pack-cache-'));
    try {
      const result = spawnSync(
        'npm',
        ['pack', '--dry-run', '--ignore-scripts', '--json', '--cache', cache],
        {
          cwd: path.resolve('packages/feed-sdk'),
          encoding: 'utf8',
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const packResult = JSON.parse(result.stdout) as Array<{ files: Array<{ path: string }> }>;
      const archivePaths = packResult[0]?.files.map(file => file.path) ?? [];
      expect(archivePaths).toContain('LICENSE');
      expect(archivePaths).toContain('NOTICE');
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });
});

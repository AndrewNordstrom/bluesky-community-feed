import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  collectTopLevelHeadings,
  findHeadingLineIndex,
  findNextTopLevelHeadingIndex,
  isMarkdownSeparatorRow,
  validateOpenApiMetadataFiles,
  validatePublicSdkGuidance,
} from '../scripts/verify-docs.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createOpenApiFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'corgi-openapi-metadata-'));
  temporaryDirectories.push(directory);
  const expectedPath = path.join(directory, 'openapi-info.json');
  const expectedInfo = {
    title: 'Corgi API',
    description: 'Community-governed feeds for Bluesky.',
    version: '1.2.0',
    contact: { name: 'Corgi Network', url: 'https://corgi.network' },
  };
  writeFileSync(expectedPath, JSON.stringify(expectedInfo));
  return { directory, expectedPath, expectedInfo };
}

describe('verify-docs helpers', () => {
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

  it('reports a missing OpenAPI artifact without throwing', () => {
    const { directory, expectedPath } = createOpenApiFixture();
    const missingPath = path.join(directory, 'missing.json');
    const problems: string[] = [];

    validateOpenApiMetadataFiles(expectedPath, [missingPath], problems);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`Unable to read OpenAPI artifact ${missingPath}`);
  });

  it('accepts matching OpenAPI metadata', () => {
    const { directory, expectedPath, expectedInfo } = createOpenApiFixture();
    const artifactPath = path.join(directory, 'artifact.json');
    const problems: string[] = [];
    writeFileSync(artifactPath, JSON.stringify({ info: expectedInfo }));

    validateOpenApiMetadataFiles(expectedPath, [artifactPath], problems);

    expect(problems).toEqual([]);
  });

  it('reports a missing canonical OpenAPI metadata file without throwing', () => {
    const { directory } = createOpenApiFixture();
    const missingExpectedPath = path.join(directory, 'missing-openapi-info.json');
    const artifactPath = path.join(directory, 'artifact.json');
    const problems: string[] = [];
    writeFileSync(artifactPath, JSON.stringify({ info: {} }));

    validateOpenApiMetadataFiles(missingExpectedPath, [artifactPath], problems);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(
      `Unable to read canonical OpenAPI metadata ${missingExpectedPath}`,
    );
  });

  it('reports malformed OpenAPI JSON without throwing', () => {
    const { directory, expectedPath } = createOpenApiFixture();
    const malformedPath = path.join(directory, 'malformed.json');
    const problems: string[] = [];
    writeFileSync(malformedPath, '{');

    validateOpenApiMetadataFiles(expectedPath, [malformedPath], problems);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`Unable to read OpenAPI artifact ${malformedPath}`);
  });

  it('reports a single-field OpenAPI metadata mismatch', () => {
    const { directory, expectedPath, expectedInfo } = createOpenApiFixture();
    const artifactPath = path.join(directory, 'artifact.json');
    const problems: string[] = [];
    writeFileSync(
      artifactPath,
      JSON.stringify({ info: { ...expectedInfo, version: '1.2.1' } }),
    );

    validateOpenApiMetadataFiles(expectedPath, [artifactPath], problems);

    expect(problems).toEqual([
      `OpenAPI metadata differs from ${expectedPath}: ${artifactPath}`,
    ]);
  });

  it('accepts GitHub-issue guidance in every public SDK instruction surface', () => {
    const { directory } = createOpenApiFixture();
    const readmePath = path.join(directory, 'README.md');
    const sourcePath = path.join(directory, 'index.ts');
    const problems: string[] = [];
    writeFileSync(readmePath, 'Open a GitHub issue; the workflow routes it to Linear.');
    writeFileSync(sourcePath, 'Propose changes through a GitHub issue.');

    validatePublicSdkGuidance([readmePath, sourcePath], problems);

    expect(problems).toEqual([]);
  });

  it('rejects stale Linear-only public SDK guidance', () => {
    const { directory } = createOpenApiFixture();
    const guidancePath = path.join(directory, 'index.ts');
    const problems: string[] = [];
    writeFileSync(guidancePath, 'Submit a Linear packet against Corgi.');

    validatePublicSdkGuidance([guidancePath], problems);

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('stale Linear-only SDK guidance found');
    expect(problems[1]).toContain('SDK guidance is missing the GitHub issue workflow');
  });
});

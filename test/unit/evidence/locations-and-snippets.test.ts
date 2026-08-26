import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createEvidenceForNode, sourceRangeForNode } from '../../../src/evidence/locations.js';
import { redactSecrets } from '../../../src/evidence/redact.js';
import { createBoundedSnippet } from '../../../src/evidence/snippets.js';
import { hashContent } from '../../../src/model/hashing.js';
import { makeSourceFileId } from '../../../src/model/ids.js';

describe('evidence locations', () => {
  const sourceText = 'const first = 1;\nconst second = 2;\n';
  const sourceFile = ts.createSourceFile(
    'src/example.ts',
    sourceText,
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  );

  it('converts TypeScript positions into one-based, end-exclusive coordinates', () => {
    const secondStatement = sourceFile.statements[1];
    expect(secondStatement).toBeDefined();

    expect(sourceRangeForNode(sourceFile, secondStatement!)).toEqual({
      startLine: 2,
      startColumn: 1,
      endLine: 2,
      endColumn: 18,
    });
  });

  it('creates deterministic evidence from an indexed source node', () => {
    const sourceFileRecord = {
      id: makeSourceFileId('src/example.ts', 'revision'),
      path: 'src/example.ts',
      contentHash: hashContent(sourceText),
      byteLength: Buffer.byteLength(sourceText),
    };
    const secondStatement = sourceFile.statements[1]!;

    const evidence = createEvidenceForNode({
      sourceFile,
      sourceFileRecord,
      node: secondStatement,
      role: 'declaration',
    });

    expect(evidence.id).toMatch(/^evidence:[a-f0-9]{32}$/);
    expect(evidence.snippet).toBe('const second = 2;');
    expect(evidence.startLine).toBe(2);
    expect(
      createEvidenceForNode({
        sourceFile,
        sourceFileRecord,
        node: secondStatement,
        role: 'declaration',
      }),
    ).toEqual(evidence);
  });

  it('rejects evidence creation when indexed content has changed', () => {
    expect(() =>
      createEvidenceForNode({
        sourceFile,
        sourceFileRecord: {
          id: makeSourceFileId('src/example.ts', 'revision'),
          path: 'src/example.ts',
          contentHash: hashContent('different'),
          byteLength: 9,
        },
        node: sourceFile.statements[0]!,
        role: 'declaration',
      }),
    ).toThrow(/hash does not match/);
  });
});

describe('evidence snippets', () => {
  it('redacts obvious quoted assignments, bearer tokens, URLs, and private keys', () => {
    const input = [
      'const apiKey = "secret-key";',
      "if (apiKey !== 'another-secret') throw new Error();",
      'Authorization: Bearer abc.def.ghi',
      'postgres://user:password@localhost/db',
      '-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----',
    ].join('\n');

    const redacted = redactSecrets(input);
    const bounded = createBoundedSnippet(input, 1_000);

    for (const output of [redacted, bounded]) {
      expect(output).not.toContain('secret-key');
      expect(output).not.toContain('another-secret');
      expect(output).not.toContain('abc.def.ghi');
      expect(output).not.toContain(':password@');
      expect(output).not.toContain('PRIVATE KEY-----secret');
      expect(output).toContain('[REDACTED]');
    }
  });

  it('truncates by Unicode code point and keeps the output within the limit', () => {
    expect(createBoundedSnippet('😀😀😀', 2)).toBe('😀…');
    expect([...createBoundedSnippet('abcdef', 4)]).toHaveLength(4);
    expect(createBoundedSnippet('abcdef', 4)).toBe('abc…');
  });

  it('rejects an invalid snippet limit', () => {
    expect(() => createBoundedSnippet('text', 0)).toThrow(RangeError);
  });
});

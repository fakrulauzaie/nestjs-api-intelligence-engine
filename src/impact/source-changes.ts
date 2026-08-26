import type { AnalysisDocument } from '../model/analysis.js';
import type { SourceFileRecord } from '../model/entities.js';
import type { SourceFileChange, SourceFileSnapshot } from './model.js';

function snapshot(source: SourceFileRecord): SourceFileSnapshot {
  return {
    sourceFileId: source.id,
    path: source.path,
    contentHash: source.contentHash,
  };
}

export function deriveSourceFileChanges(
  before: AnalysisDocument,
  after: AnalysisDocument,
): SourceFileChange[] {
  const beforeByPath = new Map(before.sourceFiles.map((source) => [source.path, source]));
  const afterByPath = new Map(after.sourceFiles.map((source) => [source.path, source]));
  const changes: SourceFileChange[] = [];

  for (const path of [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort(
    (left, right) => left.localeCompare(right),
  )) {
    const oldSource = beforeByPath.get(path);
    const newSource = afterByPath.get(path);
    if (oldSource === undefined) {
      changes.push({ change: 'added', path, before: null, after: snapshot(newSource!) });
    } else if (newSource === undefined) {
      changes.push({ change: 'removed', path, before: snapshot(oldSource), after: null });
    } else if (oldSource.contentHash !== newSource.contentHash) {
      changes.push({
        change: 'modified',
        path,
        before: snapshot(oldSource),
        after: snapshot(newSource),
      });
    }
  }
  return changes;
}

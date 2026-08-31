import type { DiagnosticSnapshot, DiffDocument, EndpointSnapshot } from './model.js';
import { assertValidDiffDocument } from './validate.js';

function escapeMarkdown(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('`', '\\`')
    .replaceAll('|', '\\|')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ');
}

function endpointLabel(snapshot: EndpointSnapshot): string {
  return `${snapshot.httpMethod} ${snapshot.path}`;
}

function handlers(snapshot: EndpointSnapshot | null): string {
  if (snapshot === null) return '-';
  if (snapshot.handlers.length === 0) return snapshot.identityStatus;
  return snapshot.handlers
    .map(
      (handler) =>
        `${escapeMarkdown(handler.qualifiedName ?? 'unresolved')} (${handler.status}, \`${handler.methodId ?? 'none'}\`)`,
    )
    .join('<br>');
}

function guards(snapshot: EndpointSnapshot | null): string {
  if (snapshot === null) return '-';
  if (snapshot.directGuards.availability === 'unavailable') return 'unavailable';
  if (snapshot.directGuards.guards.length === 0) return 'none declared';
  return snapshot.directGuards.guards
    .map((guard) => `${guard.scope}: ${escapeMarkdown(guard.name)} (${guard.status})`)
    .join('<br>');
}

function terminals(snapshot: EndpointSnapshot | null): string {
  if (snapshot === null) return '-';
  if (snapshot.terminals.availability === 'unavailable') return 'unavailable';
  if (snapshot.terminals.values.length === 0) return 'none';
  return snapshot.terminals.values
    .map(
      (terminal) =>
        `${terminal.direction} ${escapeMarkdown(terminal.tableName)} (${terminal.status})`,
    )
    .join('<br>');
}

function resourceAccesses(snapshot: EndpointSnapshot | null): string {
  if (snapshot === null) return '-';
  if (
    snapshot.resourceAccesses === undefined ||
    snapshot.resourceAccesses.availability === 'unavailable'
  ) {
    return 'unavailable';
  }
  if (snapshot.resourceAccesses.values.length === 0) return 'none';
  return snapshot.resourceAccesses.values
    .map(
      (access) =>
        `${access.technology} ${access.operation} ${escapeMarkdown(access.targetKey)} (${access.causalClass})`,
    )
    .join('<br>');
}

function diagnosticLabel(snapshot: DiagnosticSnapshot | null): string {
  if (snapshot === null) return '-';
  return `\`${snapshot.code}\` ${escapeMarkdown(snapshot.message)} (\`${snapshot.diagnosticId}\`)`;
}

export function renderDiffMarkdown(input: DiffDocument): string {
  const diff = assertValidDiffDocument(input);
  const lines = [
    '# API Intelligence Diff',
    '',
    `Diff schema: \`${diff.schemaVersion}\`  `,
    `Before: \`${diff.before.analysisId}\` (analysis \`${diff.before.analysisSchemaVersion}\`)  `,
    `After: \`${diff.after.analysisId}\` (analysis \`${diff.after.analysisSchemaVersion}\`)`,
    `Call depth: before=${diff.before.configuration.maxCallDepth}, after=${diff.after.configuration.maxCallDepth}`,
    '',
    '## Summary',
    '',
    '| Category | Count |',
    '| --- | ---: |',
    `| Endpoints added | ${diff.summary.endpointsAdded} |`,
    `| Endpoints removed | ${diff.summary.endpointsRemoved} |`,
    `| Endpoints modified | ${diff.summary.endpointsModified} |`,
    `| Assertion status changes | ${diff.summary.assertionStatusChanged} |`,
    `| Diagnostics new | ${diff.summary.diagnosticsNew} |`,
    `| Diagnostics resolved | ${diff.summary.diagnosticsResolved} |`,
    `| Diagnostics changed | ${diff.summary.diagnosticsChanged} |`,
    `| Comparison ambiguities | ${diff.summary.ambiguities} |`,
    ...(diff.interactionChanges === undefined
      ? []
      : [
          `| Interactions added | ${diff.summary.interactionsAdded ?? 0} |`,
          `| Interactions removed | ${diff.summary.interactionsRemoved ?? 0} |`,
          `| Interactions modified | ${diff.summary.interactionsModified ?? 0} |`,
          `| Interaction handlers added | ${diff.summary.interactionHandlersAdded ?? 0} |`,
          `| Interaction handlers removed | ${diff.summary.interactionHandlersRemoved ?? 0} |`,
          `| Interaction handlers modified | ${diff.summary.interactionHandlersModified ?? 0} |`,
        ]),
    ...(diff.jobQueueDispatchChanges === undefined
      ? []
      : [
          `| Job-queue dispatches added | ${diff.summary.jobQueueDispatchesAdded ?? 0} |`,
          `| Job-queue dispatches removed | ${diff.summary.jobQueueDispatchesRemoved ?? 0} |`,
          `| Job-queue dispatches modified | ${diff.summary.jobQueueDispatchesModified ?? 0} |`,
          `| Job-queue branches added | ${diff.summary.jobQueueBranchesAdded ?? 0} |`,
          `| Job-queue branches removed | ${diff.summary.jobQueueBranchesRemoved ?? 0} |`,
          `| Job-queue branches modified | ${diff.summary.jobQueueBranchesModified ?? 0} |`,
          `| Job-queue branch effects added | ${diff.summary.jobQueueBranchEffectsAdded ?? 0} |`,
          `| Job-queue branch effects removed | ${diff.summary.jobQueueBranchEffectsRemoved ?? 0} |`,
          `| Job-queue branch effects modified | ${diff.summary.jobQueueBranchEffectsModified ?? 0} |`,
        ]),
    '',
    '## Endpoint changes',
    '',
  ];

  if (diff.endpointChanges.length === 0) {
    lines.push('No semantic endpoint changes.');
  } else {
    const includesResourceAccesses = diff.endpointChanges.some(
      (change) =>
        change.before?.resourceAccesses !== undefined ||
        change.after?.resourceAccesses !== undefined,
    );
    lines.push(
      `| Change | Endpoint | Reasons | Before handler | After handler | Before guards | After guards | Before terminals | After terminals |${includesResourceAccesses ? ' Before resource access | After resource access |' : ''}`,
      `| --- | --- | --- | --- | --- | --- | --- | --- | --- |${includesResourceAccesses ? ' --- | --- |' : ''}`,
    );
    for (const change of diff.endpointChanges) {
      const snapshot = change.before ?? change.after!;
      lines.push(
        `| ${change.change} | \`${escapeMarkdown(endpointLabel(snapshot))}\` | ${change.reasons.join(', ')} | ${handlers(change.before)} | ${handlers(change.after)} | ${guards(change.before)} | ${guards(change.after)} | ${terminals(change.before)} | ${terminals(change.after)} |${includesResourceAccesses ? ` ${resourceAccesses(change.before)} | ${resourceAccesses(change.after)} |` : ''}`,
      );
    }
    lines.push('', '### Canonical endpoint references', '');
    for (const change of diff.endpointChanges) {
      const snapshot = change.before ?? change.after!;
      lines.push(
        `- \`${escapeMarkdown(endpointLabel(snapshot))}\` ${change.change}: before=\`${change.before?.endpointId ?? 'none'}\`, after=\`${change.after?.endpointId ?? 'none'}\``,
      );
    }
  }

  if (diff.interactionChanges !== undefined) {
    lines.push('', '## Interaction changes', '');
    if (diff.interactionChanges.length === 0) {
      lines.push('No semantic interaction changes.');
    } else {
      for (const change of diff.interactionChanges) {
        const snapshot = change.before ?? change.after!;
        lines.push(
          `- **${change.change}** ${snapshot.kind} target \`${escapeMarkdown(snapshot.targetKey)}\` (${change.reasons.join(', ')}): before=\`${change.before?.interactionId ?? 'none'}\`, after=\`${change.after?.interactionId ?? 'none'}\``,
        );
      }
    }
    lines.push('', '## Interaction handler changes', '');
    if ((diff.interactionHandlerChanges ?? []).length === 0) {
      lines.push('No semantic interaction-handler changes.');
    } else {
      for (const change of diff.interactionHandlerChanges ?? []) {
        const snapshot = change.before ?? change.after!;
        lines.push(
          `- **${change.change}** ${snapshot.kind} handler target \`${escapeMarkdown(snapshot.targetKey)}\` (${change.reasons.join(', ')}): before=\`${change.before?.handlerId ?? 'none'}\`, after=\`${change.after?.handlerId ?? 'none'}\``,
        );
      }
    }
  }

  if (diff.jobQueueDispatchChanges !== undefined) {
    lines.push('', '## Job-queue branch changes', '');
    const allChanges = [
      ...diff.jobQueueDispatchChanges.map((change) => ({ family: 'dispatch', change })),
      ...(diff.jobQueueBranchChanges ?? []).map((change) => ({ family: 'branch', change })),
      ...(diff.jobQueueBranchEffectChanges ?? []).map((change) => ({
        family: 'branch effect',
        change,
      })),
    ];
    if (allChanges.length === 0) {
      lines.push('No semantic job-queue branch changes.');
    } else {
      for (const { family, change } of allChanges) {
        lines.push(
          `- **${change.change}** ${family} \`${escapeMarkdown(change.key.encoded)}\` (${change.reasons.join(', ')})`,
        );
      }
    }
  }

  lines.push('', '## Assertion status changes', '');
  if (diff.assertionStatusChanges.length === 0) {
    lines.push('No matched assertion changed resolution state.');
  } else {
    for (const change of diff.assertionStatusChanges) {
      lines.push(
        `- \`${change.before.predicate}\`: ${change.before.status} → ${change.after.status}; before=\`${change.before.assertionId}\`, after=\`${change.after.assertionId}\`; evidence before=${change.before.evidenceIds.map((id) => `\`${id}\``).join(', ') || 'none'}, after=${change.after.evidenceIds.map((id) => `\`${id}\``).join(', ') || 'none'}`,
      );
    }
  }

  lines.push('', '## Diagnostic changes', '');
  if (diff.diagnosticChanges.length === 0) {
    lines.push('No semantic diagnostic changes.');
  } else {
    for (const change of diff.diagnosticChanges) {
      lines.push(
        `- **${change.change}** (${change.reasons.join(', ')}): before=${diagnosticLabel(change.before)}; after=${diagnosticLabel(change.after)}`,
      );
    }
  }

  lines.push('', '## Ambiguities', '');
  if (diff.ambiguities.length === 0) {
    lines.push('No comparison ambiguity.');
  } else {
    for (const ambiguity of diff.ambiguities) {
      lines.push(
        `- \`${ambiguity.kind}\` on ${ambiguity.side} ${ambiguity.recordKind} key \`${escapeMarkdown(ambiguity.key.encoded)}\`: before=${ambiguity.beforeCandidateIds.map((id) => `\`${id}\``).join(', ') || 'none'}; after=${ambiguity.afterCandidateIds.map((id) => `\`${id}\``).join(', ') || 'none'}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

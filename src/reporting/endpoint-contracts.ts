import type { AnalysisDocument } from '../model/analysis.js';
import type {
  ContractFieldRecord,
  ContractTypeRecord,
  DeclaredTypeShape,
} from '../model/entities.js';

function inline(value: string): string {
  return `\`${value.replaceAll('|', '\\|').replaceAll('`', '\\`')}\``;
}

function yesNoUnknown(value: boolean | null): string {
  return value === null ? 'unknown' : value ? 'yes' : 'no';
}

function shapeLabel(shape: DeclaredTypeShape): string {
  const alternatives =
    shape.alternatives.length === 0
      ? ''
      : `; alternatives: ${shape.alternatives.map(inline).join(', ')}`;
  return `${inline(shape.kind)} / ${inline(shape.source)}${alternatives}`;
}

function fieldModifiers(field: ContractFieldRecord): string {
  const values = [
    ...(field.optional ? ['optional'] : []),
    ...(field.readonly ? ['readonly'] : []),
    ...(field.inherited ? ['inherited'] : []),
  ];
  return values.length === 0 ? '—' : values.join(', ');
}

export function renderEndpointContractsMarkdown(
  analysis: AnalysisDocument,
  selectedEndpointIds?: ReadonlySet<string>,
): string {
  const lines = [
    '# Declared API contracts',
    '',
    '> This is a static declaration inventory. Decorators and validator annotations do not prove',
    '> effective runtime validation, transformation, authentication, or serialized HTTP output.',
    '',
  ];
  if (analysis.schemaVersion === '1.0.0') {
    lines.push('Contract inventory is unavailable in analysis schema 1.0.0.', '');
    return `${lines.join('\n')}\n`;
  }

  const methodById = new Map(analysis.methods.map((method) => [method.id, method]));
  const typeById = new Map(analysis.contractTypes.map((type) => [type.id, type]));
  const fieldsByType = new Map<string, ContractFieldRecord[]>();
  for (const field of analysis.contractFields) {
    fieldsByType.set(field.contractTypeId, [
      ...(fieldsByType.get(field.contractTypeId) ?? []),
      field,
    ]);
  }
  const sourceById = new Map(analysis.sourceFiles.map((source) => [source.id, source]));
  const evidenceById = new Map(analysis.evidence.map((evidence) => [evidence.id, evidence]));
  const evidenceLabel = (evidenceId: string | null): string => {
    if (evidenceId === null) return 'derived / no direct declaration';
    const evidence = evidenceById.get(evidenceId);
    const source = evidence === undefined ? undefined : sourceById.get(evidence.fileId);
    return evidence === undefined || source === undefined
      ? inline(evidenceId)
      : `${inline(`${source.path}:${evidence.startLine}:${evidence.startColumn}`)} (${inline(evidence.role)})`;
  };
  const renderTypeFields = (types: readonly ContractTypeRecord[]): void => {
    for (const type of [...types].sort((left, right) =>
      left.qualifiedName.localeCompare(right.qualifiedName),
    )) {
      lines.push(
        `#### ${type.declarationKind === 'class' ? 'DTO class' : 'DTO interface'} ${inline(type.qualifiedName)}`,
        '',
        `Shape source: ${inline(type.shapeSource)}. Declaration: ${evidenceLabel(type.declarationEvidenceId)}.`,
        '',
      );
      const fields = [...(fieldsByType.get(type.id) ?? [])].sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      if (fields.length === 0) {
        lines.push('No checker-visible fields were recorded.', '');
        continue;
      }
      lines.push('| Field | Type | Modifiers | Shape source | Declared constraints | Evidence |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const field of fields) {
        const constraints =
          field.declaredConstraints.length === 0
            ? '—'
            : field.declaredConstraints
                .map((constraint) =>
                  inline(`${constraint.name}(${constraint.argumentTexts.join(', ')})`),
                )
                .join(', ');
        lines.push(
          `| ${inline(field.name)} | ${inline(field.typeText)} | ${fieldModifiers(field)} | ${inline(field.shapeSource)} | ${constraints} | ${evidenceLabel(field.declarationEvidenceId)} |`,
        );
      }
      lines.push('');
    }
  };

  const handlers = new Map<string, string>();
  for (const assertion of analysis.assertions) {
    if (
      assertion.predicate === 'ENDPOINT_IMPLEMENTED_BY' &&
      assertion.objectId !== null &&
      assertion.status === 'resolved'
    ) {
      handlers.set(assertion.subjectId, assertion.objectId);
    }
  }
  const parametersByMethod = new Map<string, (typeof analysis.requestParameters)[number][]>();
  for (const parameter of analysis.requestParameters) {
    parametersByMethod.set(parameter.methodId, [
      ...(parametersByMethod.get(parameter.methodId) ?? []),
      parameter,
    ]);
  }
  const responseByMethod = new Map(
    analysis.responseContracts.map((response) => [response.methodId, response]),
  );

  lines.push('## Endpoint declarations', '');
  for (const endpoint of [...analysis.endpoints].sort((left, right) =>
    `${left.path}:${left.httpMethod}`.localeCompare(`${right.path}:${right.httpMethod}`),
  )) {
    if (selectedEndpointIds !== undefined && !selectedEndpointIds.has(endpoint.id)) continue;
    const methodId = handlers.get(endpoint.id);
    const method = methodId === undefined ? undefined : methodById.get(methodId);
    lines.push(
      `### ${inline(endpoint.httpMethod)} ${inline(endpoint.path)}`,
      '',
      `Handler: ${method === undefined ? 'unresolved' : inline(method.qualifiedName)}.`,
      '',
      '#### Request declarations',
      '',
    );
    const parameters =
      methodId === undefined
        ? []
        : [...(parametersByMethod.get(methodId) ?? [])].sort(
            (left, right) => left.parameterIndex - right.parameterIndex,
          );
    if (parameters.length === 0) {
      lines.push('No supported `@Body()`, `@Param()`, or `@Query()` declaration was recorded.', '');
    } else {
      lines.push('| Source | Parameter | Selector | Declared type | Shape | Evidence |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const parameter of parameters) {
        const selector =
          parameter.selectorState === 'whole'
            ? 'whole value'
            : parameter.selectorState === 'unknown'
              ? 'unknown'
              : inline(parameter.selector ?? '');
        lines.push(
          `| ${inline(parameter.sourceKind)} | ${inline(`${parameter.parameterIndex}:${parameter.parameterName}`)} | ${selector} | ${inline(parameter.declaredType.typeText)}${parameter.optional ? ' (optional)' : ''} | ${shapeLabel(parameter.declaredType)} | ${evidenceLabel(parameter.decoratorEvidenceId)} |`,
        );
      }
      lines.push('');
      const requestTypes = [
        ...new Set(parameters.flatMap((parameter) => parameter.declaredType.contractTypeIds)),
      ].flatMap((id) => {
        const type = typeById.get(id);
        return type === undefined ? [] : [type];
      });
      renderTypeFields(requestTypes);
    }

    lines.push('#### Declared response', '');
    const response = methodId === undefined ? undefined : responseByMethod.get(methodId);
    if (response === undefined) {
      lines.push('No declared response contract was recorded.', '');
    } else {
      lines.push('| Handling | Handler return type | Normalized shape | Shape state | Evidence |');
      lines.push('| --- | --- | --- | --- | --- |');
      lines.push(
        `| ${inline(response.handling)} | ${inline(response.outerTypeText)} | ${inline(response.declaredType.typeText)}${response.promiseUnwrapped ? ' (Promise unwrapped once)' : ''} | ${shapeLabel(response.declaredType)} | ${evidenceLabel(response.declarationEvidenceId)} |`,
        '',
      );
      if (response.handling === 'manual') {
        lines.push(
          `Manual ${inline('@Res()')} evidence: ${evidenceLabel(response.manualResponseEvidenceId)}. No serialized response schema is claimed.`,
          '',
        );
      }
      const responseTypes = response.declaredType.contractTypeIds.flatMap((id) => {
        const type = typeById.get(id);
        return type === undefined ? [] : [type];
      });
      renderTypeFields(responseTypes);
    }
  }

  lines.push('## Request-to-column influence', '');
  const selectedMethodIds =
    selectedEndpointIds === undefined
      ? null
      : new Set(
          [...selectedEndpointIds].flatMap((endpointId) => {
            const methodId = handlers.get(endpointId);
            return methodId === undefined ? [] : [methodId];
          }),
        );
  const originsById = new Map(analysis.requestFieldOrigins.map((origin) => [origin.id, origin]));
  const parametersById = new Map(
    analysis.requestParameters.map((parameter) => [parameter.id, parameter]),
  );
  const columnsById = new Map(analysis.entityColumns.map((column) => [column.id, column]));
  const assertionsById = new Map(analysis.assertions.map((assertion) => [assertion.id, assertion]));
  const influences = analysis.columnInfluences
    .filter((influence) => {
      if (selectedMethodIds === null) return true;
      const origin = originsById.get(influence.originId);
      const parameter =
        origin === undefined ? undefined : parametersById.get(origin.requestParameterId);
      return parameter !== undefined && selectedMethodIds.has(parameter.methodId);
    })
    .sort((left, right) =>
      `${methodById.get(left.methodId)?.qualifiedName ?? ''}:${left.sinkPropertyName}:${left.id}`.localeCompare(
        `${methodById.get(right.methodId)?.qualifiedName ?? ''}:${right.sinkPropertyName}:${right.id}`,
      ),
    );
  if (influences.length === 0) {
    lines.push('No supported request-field influence on explicit write columns was recorded.', '');
  } else {
    lines.push(
      '| Sink method | Request origin | Call path | Entity column | State | Sink | Assertion | Evidence |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const influence of influences) {
      const method = methodById.get(influence.methodId);
      const origin = originsById.get(influence.originId);
      const parameter =
        origin === undefined ? undefined : parametersById.get(origin.requestParameterId);
      const column = columnsById.get(influence.columnId);
      const assertion = assertionsById.get(influence.assertionId);
      const entity =
        column === undefined
          ? undefined
          : analysis.entities.find(({ id }) => id === column.entityId);
      const originLabel =
        origin === undefined || parameter === undefined
          ? influence.originId
          : `${parameter.sourceKind}:${parameter.parameterName}.${origin.propertyPath.join('.')} (${origin.resolution})`;
      const columnLabel =
        column === undefined
          ? influence.columnId
          : `${entity?.displayName ?? column.entityId}.${column.propertyName} -> ${column.databaseName ?? 'unknown database name'}; transformer ${column.transformer}`;
      const callPathLabel =
        influence.callPath.length === 0
          ? 'same method'
          : influence.callPath
              .map(
                (step) =>
                  `${methodById.get(step.callerMethodId)?.qualifiedName ?? step.callerMethodId} -> ${methodById.get(step.calleeMethodId)?.qualifiedName ?? step.calleeMethodId}`,
              )
              .join(' | ');
      lines.push(
        `| ${inline(method?.qualifiedName ?? influence.methodId)} | ${inline(originLabel)} | ${inline(callPathLabel)} | ${inline(columnLabel)} | ${inline(influence.state)} | ${inline(`${influence.sinkKind}:${influence.sinkPropertyName}`)} | ${inline(assertion?.status ?? 'missing')} | ${evidenceLabel(influence.sinkEvidenceId)} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    'These records mean “may influence,” not byte-for-byte value equality. Same-method and bounded checker-resolved service-call paths are supported. Raw-SQL parameters, `save()`/`remove()`, spreads, computed write keys, ambiguous dispatch, callbacks, cycles, and over-depth paths do not create guessed edges.',
    '',
  );

  lines.push('## Entity-column declarations', '');
  if (analysis.entityColumns.length === 0) {
    lines.push('No supported TypeORM entity-column declarations were recorded.', '');
  } else {
    const entityById = new Map(analysis.entities.map((entity) => [entity.id, entity]));
    const classById = new Map(analysis.classes.map((sourceClass) => [sourceClass.id, sourceClass]));
    lines.push(
      '| Entity | Property | Database name | Name source | Kind | Insert | Update | Transformer | Inherited | Evidence |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const column of [...analysis.entityColumns].sort((left, right) =>
      `${entityById.get(left.entityId)?.displayName ?? ''}:${left.propertyName}`.localeCompare(
        `${entityById.get(right.entityId)?.displayName ?? ''}:${right.propertyName}`,
      ),
    )) {
      const entity = entityById.get(column.entityId);
      const declaringClass = classById.get(column.declaringClassId);
      lines.push(
        `| ${inline(entity?.displayName ?? column.entityId)} | ${inline(column.propertyName)} | ${column.databaseName === null ? 'unknown' : inline(column.databaseName)} | ${inline(column.databaseNameSource)} | ${inline(column.columnKind)} | ${yesNoUnknown(column.insert)} | ${yesNoUnknown(column.update)} | ${inline(column.transformer)} | ${column.inherited ? `yes (${inline(declaringClass?.qualifiedName ?? column.declaringClassId)})` : 'no'} | ${evidenceLabel(column.decoratorEvidenceId)} |`,
      );
    }
    lines.push(
      '',
      'Property-name fallbacks are declaration-level metadata only; configured naming strategies and database-side behavior are outside this report.',
      '',
    );
  }

  return `${lines.join('\n')}\n`;
}

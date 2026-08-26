import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord, AssertionStatus } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type {
  ClassRecord,
  ClassRole,
  DatabaseColumnNameSource,
  EntityColumnKind,
  EntityColumnRecord,
  MethodRecord,
  RepositoryBindingRecord,
  TableNameSource,
  TableRecord,
  TypeOrmEntityRecord,
  TransformerPresenceState,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  makeAssertionId,
  makeEntityId,
  makeEntityColumnId,
  makeRepositoryBindingId,
  makeTableId,
} from '../model/ids.js';
import { resolveSimpleString } from '../ts-index/constants.js';
import { resolveDecorators } from '../ts-index/decorators.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import { resolveAliasedSymbol, symbolDeclarationFile } from '../ts-index/symbols.js';
import {
  createClassRecord,
  createDeclarationEvidence,
  createMethodRecord,
} from './canonical-records.js';
import {
  constructorToAnalyze,
  explicitParameterMemberAssignments,
  isThisMember,
  memberBindingForParameter,
} from './constructor-members.js';
import { declarationBelongsToPackage, isPackageDecorator } from './package-symbols.js';
import {
  analyzeTypeOrmQueryBuilders,
  type QueryBuilderRootKind,
  type QueryBuilderRootResolution,
  type QueryBuilderTableTarget,
  type QueryBuilderTargetResolution,
} from './typeorm-query-builder.js';

export const TYPEORM_ENTITY_TABLE_RULE_ID = 'typeorm.entity-table.v1';
export const TYPEORM_REPOSITORY_INJECTION_RULE_ID = 'typeorm.repository-injection.v1';
export const TYPEORM_REPOSITORY_ENTITY_RULE_ID = 'typeorm.repository-entity.v1';
export const TYPEORM_ENTITY_COLUMN_RULE_ID = 'typeorm.entity-column.v1';

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_TYPEORM_MODULE = '@nestjs/typeorm';
const TYPEORM_MODULE = 'typeorm';
export const TYPEORM_READ_OPERATIONS = [
  'find',
  'findOne',
  'findOneBy',
  'findBy',
  'count',
  'exists',
] as const;
export const TYPEORM_WRITE_OPERATIONS = ['save', 'insert', 'update', 'delete', 'remove'] as const;
const READ_OPERATIONS = new Set<string>(TYPEORM_READ_OPERATIONS);
const WRITE_OPERATIONS = new Set<string>(TYPEORM_WRITE_OPERATIONS);
const IMPRECISE_COLUMN_OPERATIONS = new Set(['save', 'remove']);
const COLUMN_DECORATORS = ['Column', 'PrimaryColumn', 'PrimaryGeneratedColumn'] as const;

type TypeOrmColumnDecorator = (typeof COLUMN_DECORATORS)[number];

export interface TypeOrmColumnMetadata {
  readonly entityId: string;
  readonly propertyName: string;
  readonly decorator: TypeOrmColumnDecorator;
  readonly decoratorEvidenceId: string;
}

export interface TypeOrmPersistenceExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly repositoryBindings: readonly RepositoryBindingRecord[];
  readonly entities: readonly TypeOrmEntityRecord[];
  readonly tables: readonly TableRecord[];
  readonly columnMetadata: readonly TypeOrmColumnMetadata[];
  readonly entityColumns: readonly EntityColumnRecord[];
  /** Internal AST observations consumed by the bounded request-provenance pass. */
  readonly objectWriteSinks: readonly TypeOrmObjectWriteSink[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

export interface TypeOrmObjectWriteSink {
  readonly methodId: string;
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
  readonly indexedMethod: IndexedMethod;
  readonly kind:
    | 'repository_insert'
    | 'repository_update'
    | 'query_builder_insert'
    | 'query_builder_update';
  readonly valueExpression: ts.Expression;
  readonly entityTargets: readonly {
    readonly entityId: string;
    readonly status: 'resolved' | 'ambiguous';
    readonly evidenceIds: readonly string[];
  }[];
  readonly operationEvidenceId: string;
  readonly evidenceIds: readonly string[];
}

interface LocatedClass {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
}

interface LocatedMethod extends LocatedClass {
  readonly method: IndexedMethod;
}

interface EntityTableMapping {
  readonly table: TableRecord;
  readonly evidenceIds: readonly string[];
}

interface LocatedEntity extends LocatedClass {
  readonly entity: TypeOrmEntityRecord;
  readonly mapping: EntityTableMapping | null;
}

interface ResolvedRepositoryBinding {
  readonly entityTargets: readonly LocatedEntity[];
  readonly resolutionEvidenceId: string;
}

interface RecognizedTypeOrmRoot {
  readonly kind: QueryBuilderRootKind;
  readonly type: ts.Type;
}

interface TypeOrmRootTypeAnalysis {
  readonly recognized: readonly RecognizedTypeOrmRoot[];
  readonly hasOther: boolean;
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function ownerRoles(located: LocatedClass): readonly ClassRole[] {
  const isController = located.indexedClass.decorators.some((decorator) =>
    isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Controller'),
  );
  const isProvider = located.indexedClass.decorators.some((decorator) =>
    isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Injectable'),
  );
  return [
    ...(isController ? (['controller'] as const) : []),
    ...(isProvider ? (['provider'] as const) : []),
  ];
}

function propertyName(member: ts.PropertyDeclaration): string {
  return ts.isIdentifier(member.name) ||
    ts.isStringLiteral(member.name) ||
    ts.isNumericLiteral(member.name)
    ? member.name.text
    : member.name.getText(member.getSourceFile());
}

interface ColumnOptionsResolution {
  readonly databaseName: string | null;
  readonly databaseNameSource: DatabaseColumnNameSource;
  readonly insert: boolean | null;
  readonly update: boolean | null;
  readonly transformer: TransformerPresenceState;
}

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = property.name;
    if (
      (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) &&
      propertyName.text === name
    ) {
      return property;
    }
  }
  return null;
}

function literalBoolean(node: ts.Expression): boolean | null {
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  return null;
}

function columnOptions(
  decorator: ReturnType<typeof resolveDecorators>[number],
  memberName: string,
): ColumnOptionsResolution {
  const expression = decorator.node.expression;
  const args = ts.isCallExpression(expression) ? [...expression.arguments] : [];
  const options = args.findLast(ts.isObjectLiteralExpression);
  const hasDynamicOptions =
    options === undefined &&
    args.some(
      (argument) =>
        !ts.isStringLiteral(argument) &&
        !ts.isNoSubstitutionTemplateLiteral(argument) &&
        !ts.isNumericLiteral(argument),
    );
  const hasSpread = options?.properties.some(ts.isSpreadAssignment) ?? false;
  const optionsKnown = !hasDynamicOptions && !hasSpread;
  if (!optionsKnown) {
    return {
      databaseName: null,
      databaseNameSource: 'unknown',
      insert: null,
      update: null,
      transformer: 'unknown',
    };
  }

  const nameProperty = options === undefined ? null : objectProperty(options, 'name');
  const resolvedName =
    nameProperty !== null &&
    (ts.isStringLiteral(nameProperty.initializer) ||
      ts.isNoSubstitutionTemplateLiteral(nameProperty.initializer))
      ? nameProperty.initializer.text
      : null;
  const databaseName =
    resolvedName !== null && resolvedName.length > 0
      ? resolvedName
      : nameProperty === null
        ? memberName
        : null;
  const databaseNameSource: DatabaseColumnNameSource =
    nameProperty === null
      ? 'property_name_fallback'
      : databaseName === null
        ? 'unknown'
        : 'explicit';
  const booleanOption = (name: string): boolean | null => {
    if (options === undefined) return true;
    const property = objectProperty(options, name);
    return property === null ? true : literalBoolean(property.initializer);
  };

  return {
    databaseName,
    databaseNameSource,
    insert: booleanOption('insert'),
    update: booleanOption('update'),
    transformer:
      options === undefined || objectProperty(options, 'transformer') === null
        ? 'absent'
        : 'present',
  };
}

function columnKind(decorator: TypeOrmColumnDecorator): EntityColumnKind {
  switch (decorator) {
    case 'PrimaryColumn':
      return 'primary';
    case 'PrimaryGeneratedColumn':
      return 'primary_generated';
    case 'Column':
      return 'regular';
  }
}

function repositoryOperation(name: string): 'read' | 'write' | null {
  if (READ_OPERATIONS.has(name)) return 'read';
  if (WRITE_OPERATIONS.has(name)) return 'write';
  return null;
}

function operationRuleId(operation: string): string {
  return `typeorm.repository.${operation}.v1`;
}

function isNestedThisBoundary(node: ts.Node): boolean {
  return ts.isFunctionLike(node) && !ts.isArrowFunction(node);
}

export function extractTypeOrmPersistence(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
}): TypeOrmPersistenceExtraction {
  const classByNode = new Map<ts.ClassDeclaration, LocatedClass>();
  const sourceByAbsolutePath = new Map<string, IndexedSourceFile>();
  for (const source of input.sourceIndex.sourceFiles) {
    sourceByAbsolutePath.set(absolutePathKey(source.sourceFile.fileName), source);
    for (const indexedClass of source.classes) {
      const locatedClass = { source, indexedClass };
      classByNode.set(indexedClass.node, locatedClass);
    }
  }

  const evidenceById = new Map<string, EvidenceRecord>();
  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const repositoryBindingById = new Map<string, RepositoryBindingRecord>();
  const entityById = new Map<string, TypeOrmEntityRecord>();
  const tableById = new Map<string, TableRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const diagnostics: DiagnosticRecord[] = [];
  const columnMetadata: TypeOrmColumnMetadata[] = [];
  const entityColumnById = new Map<string, EntityColumnRecord>();
  const objectWriteSinks: TypeOrmObjectWriteSink[] = [];

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };

  const ensureClassRecord = (located: LocatedClass, roles: readonly ClassRole[]): ClassRecord => {
    const declarationEvidenceId = addEvidence(
      createDeclarationEvidence(
        located.source,
        located.indexedClass.node,
        input.evidenceSnippetLimit,
      ),
    );
    const candidate = createClassRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId,
      roles,
    });
    const existing = classById.get(candidate.id);
    const record =
      existing === undefined
        ? candidate
        : { ...existing, roles: [...new Set([...existing.roles, ...roles])] };
    classById.set(record.id, record);
    return record;
  };

  const ensureMethodRecord = (located: LocatedMethod): MethodRecord => {
    const owner = ensureClassRecord(located, ownerRoles(located));
    const declarationEvidenceId = addEvidence(
      createDeclarationEvidence(located.source, located.method.node, input.evidenceSnippetLimit),
    );
    const record = createMethodRecord({
      source: located.source,
      indexedClass: located.indexedClass,
      method: located.method,
      classId: owner.id,
      repositoryRevision: input.repositoryRevision,
      declarationEvidenceId,
    });
    methodById.set(record.id, record);
    return record;
  };

  const addAssertion = (record: AssertionRecord): void => {
    const existing = assertionById.get(record.id);
    assertionById.set(
      record.id,
      existing === undefined
        ? record
        : {
            ...record,
            status:
              existing.status === 'ambiguous' || record.status === 'ambiguous'
                ? 'ambiguous'
                : record.status,
            evidenceIds: [...new Set([...existing.evidenceIds, ...record.evidenceIds])],
          },
    );
  };

  const evidenceForExternalNode = (node: ts.Node, role: EvidenceRecord['role']): string | null => {
    const source = sourceByAbsolutePath.get(absolutePathKey(node.getSourceFile().fileName));
    return source === undefined
      ? null
      : addEvidence(
          createEvidenceForNode({
            sourceFile: source.sourceFile,
            sourceFileRecord: source.inventorySource.record,
            node,
            role,
            snippetLimit: input.evidenceSnippetLimit,
          }),
        );
  };

  const evidenceForNode = (node: ts.Node, role: EvidenceRecord['role']): string => {
    const evidenceId = evidenceForExternalNode(node, role);
    if (evidenceId === null) {
      throw new Error(
        `Could not anchor TypeORM evidence in indexed source ${node.getSourceFile().fileName}.`,
      );
    }
    return evidenceId;
  };

  const locatedEntityByClassNode = new Map<ts.ClassDeclaration, LocatedEntity>();
  for (const located of classByNode.values()) {
    const entityDecorator = located.indexedClass.decorators.find((decorator) =>
      isPackageDecorator(decorator, TYPEORM_MODULE, 'Entity'),
    );
    if (entityDecorator === undefined) continue;

    const classRecord = ensureClassRecord(located, ['entity']);
    const entity: TypeOrmEntityRecord = {
      id: makeEntityId(classRecord.id),
      classId: classRecord.id,
      displayName: located.indexedClass.name,
    };
    entityById.set(entity.id, entity);
    const decoratorEvidenceId = addEvidence(
      createEvidenceForNode({
        sourceFile: located.source.sourceFile,
        sourceFileRecord: located.source.inventorySource.record,
        node: entityDecorator.node,
        role: 'decorator',
        snippetLimit: input.evidenceSnippetLimit,
      }),
    );

    let tableName: string | null = null;
    let nameSource: TableNameSource | null = null;
    const mappingEvidenceIds = [decoratorEvidenceId, classRecord.declarationEvidenceId];
    const expression = entityDecorator.node.expression;
    const firstArgument = ts.isCallExpression(expression) ? expression.arguments[0] : undefined;
    if (firstArgument === undefined) {
      if (located.indexedClass.name !== '<anonymous>') {
        tableName = located.indexedClass.name.toLowerCase();
        nameSource = 'default_lowercase_class_name';
      }
    } else {
      const resolution = resolveSimpleString(firstArgument, input.checker);
      for (const evidenceNode of resolution.evidenceNodes) {
        if (evidenceNode === firstArgument) continue;
        const evidenceId = evidenceForExternalNode(evidenceNode, 'resolution_basis');
        if (evidenceId !== null) mappingEvidenceIds.push(evidenceId);
      }
      if (resolution.status === 'resolved' && resolution.value.length > 0) {
        tableName = resolution.value;
        nameSource = 'explicit';
      }
    }

    let mapping: EntityTableMapping | null = null;
    if (tableName !== null && nameSource !== null) {
      const table: TableRecord = {
        id: makeTableId(tableName),
        name: tableName,
        nameSource,
      };
      tableById.set(table.id, table);
      const assertionId = makeAssertionId({
        subjectId: entity.id,
        predicate: 'ENTITY_MAPS_TO_TABLE',
        objectId: table.id,
        ruleId: TYPEORM_ENTITY_TABLE_RULE_ID,
      });
      addAssertion({
        id: assertionId,
        subjectId: entity.id,
        predicate: 'ENTITY_MAPS_TO_TABLE',
        objectId: table.id,
        status: 'resolved',
        ruleId: TYPEORM_ENTITY_TABLE_RULE_ID,
        evidenceIds: mappingEvidenceIds,
      });
      mapping = { table, evidenceIds: mappingEvidenceIds };
    } else {
      diagnostics.push(
        createDiagnostic({
          code: 'TYPEORM_ENTITY_UNRESOLVED',
          subjectId: entity.id,
          message: `Table name for TypeORM entity ${located.indexedClass.qualifiedName} is outside the supported literal, one-const-hop, or default-name rules.`,
          evidenceIds: mappingEvidenceIds,
        }),
      );
    }

    const locatedEntity = { ...located, entity, mapping };
    locatedEntityByClassNode.set(located.indexedClass.node, locatedEntity);

    const hierarchy: LocatedClass[] = [];
    const seenHierarchy = new Set<ts.ClassDeclaration>();
    const visitHierarchy = (current: LocatedClass): void => {
      if (seenHierarchy.has(current.indexedClass.node)) return;
      seenHierarchy.add(current.indexedClass.node);
      const currentType = input.checker.getTypeAtLocation(current.indexedClass.node);
      if ((currentType.flags & ts.TypeFlags.Object) !== 0) {
        for (const baseType of input.checker.getBaseTypes(currentType as ts.InterfaceType) ?? []) {
          const baseSymbol = resolveAliasedSymbol(
            input.checker,
            baseType.aliasSymbol ?? baseType.getSymbol(),
          );
          for (const declaration of baseSymbol?.declarations ?? []) {
            if (!ts.isClassDeclaration(declaration)) continue;
            const base = classByNode.get(declaration);
            if (base !== undefined) visitHierarchy(base);
          }
        }
      }
      hierarchy.push(current);
    };
    visitHierarchy(located);

    const declarationsByProperty = new Map<
      string,
      {
        located: LocatedClass;
        member: ts.PropertyDeclaration;
        decorator: ReturnType<typeof resolveDecorators>[number];
        decoratorName: TypeOrmColumnDecorator;
      }
    >();
    for (const declarationOwner of hierarchy) {
      for (const member of declarationOwner.indexedClass.node.members) {
        if (!ts.isPropertyDeclaration(member)) continue;
        const decorators = resolveDecorators(member, input.checker);
        const decorator = decorators.find((candidate) =>
          COLUMN_DECORATORS.some((name) => isPackageDecorator(candidate, TYPEORM_MODULE, name)),
        );
        if (decorator === undefined) continue;
        const decoratorName = COLUMN_DECORATORS.find((name) =>
          isPackageDecorator(decorator, TYPEORM_MODULE, name),
        );
        if (decoratorName === undefined) continue;
        declarationsByProperty.set(propertyName(member), {
          located: declarationOwner,
          member,
          decorator,
          decoratorName,
        });
      }
    }

    for (const [memberName, declaration] of declarationsByProperty) {
      const declaringClass = ensureClassRecord(declaration.located, []);
      const declarationEvidenceId = addEvidence(
        createDeclarationEvidence(
          declaration.located.source,
          declaration.member,
          input.evidenceSnippetLimit,
        ),
      );
      const decoratorEvidenceId = addEvidence(
        createEvidenceForNode({
          sourceFile: declaration.located.source.sourceFile,
          sourceFileRecord: declaration.located.source.inventorySource.record,
          node: declaration.decorator.node,
          role: 'decorator',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      const options = columnOptions(declaration.decorator, memberName);
      const id = makeEntityColumnId({
        entityId: entity.id,
        declaringClassId: declaringClass.id,
        propertyName: memberName,
      });
      const column: EntityColumnRecord = {
        id,
        entityId: entity.id,
        declaringClassId: declaringClass.id,
        propertyName: memberName,
        ...options,
        columnKind: columnKind(declaration.decoratorName),
        inherited: declaration.located.indexedClass.node !== located.indexedClass.node,
        declarationEvidenceId,
        decoratorEvidenceId,
      };
      entityColumnById.set(id, column);
      columnMetadata.push({
        entityId: entity.id,
        propertyName: memberName,
        decorator: declaration.decoratorName,
        decoratorEvidenceId,
      });
      const assertionId = makeAssertionId({
        subjectId: entity.id,
        predicate: 'ENTITY_DECLARES_COLUMN',
        objectId: id,
        ruleId: TYPEORM_ENTITY_COLUMN_RULE_ID,
      });
      addAssertion({
        id: assertionId,
        subjectId: entity.id,
        predicate: 'ENTITY_DECLARES_COLUMN',
        objectId: id,
        status: 'resolved',
        ruleId: TYPEORM_ENTITY_COLUMN_RULE_ID,
        evidenceIds: [declarationEvidenceId, decoratorEvidenceId],
      });
    }
  }

  const entityCandidatesFor = (expression: ts.Expression): readonly LocatedEntity[] => {
    const symbols = new Set<ts.Symbol>();
    const addSymbol = (symbol: ts.Symbol | undefined): void => {
      const resolved = resolveAliasedSymbol(input.checker, symbol);
      if (resolved !== null) symbols.add(resolved);
    };
    addSymbol(input.checker.getSymbolAtLocation(expression));
    const expressionType = input.checker.getTypeAtLocation(expression);
    const types = expressionType.isUnion() ? expressionType.types : [expressionType];
    for (const type of types) {
      addSymbol(type.aliasSymbol);
      addSymbol(type.getSymbol());
    }

    const candidates = new Set<LocatedEntity>();
    for (const symbol of symbols) {
      for (const declaration of symbol.declarations ?? []) {
        if (!ts.isClassDeclaration(declaration)) continue;
        const entity = locatedEntityByClassNode.get(declaration);
        if (entity !== undefined) candidates.add(entity);
      }
    }
    return [...candidates];
  };

  const entityCandidatesForType = (type: ts.Type): readonly LocatedEntity[] => {
    const candidates = new Set<LocatedEntity>();
    const visitType = (current: ts.Type): void => {
      if (current.isUnion()) {
        for (const member of current.types) visitType(member);
        return;
      }
      const symbol = resolveAliasedSymbol(
        input.checker,
        current.aliasSymbol ?? current.getSymbol(),
      );
      for (const declaration of symbol?.declarations ?? []) {
        if (!ts.isClassDeclaration(declaration)) continue;
        const entity = locatedEntityByClassNode.get(declaration);
        if (entity !== undefined) candidates.add(entity);
      }
    };
    visitType(type);
    return [...candidates];
  };

  const rootKindForType = (type: ts.Type): QueryBuilderRootKind | null => {
    const symbol = resolveAliasedSymbol(input.checker, type.aliasSymbol ?? type.getSymbol());
    if (
      symbol === null ||
      !declarationBelongsToPackage(symbolDeclarationFile(symbol), TYPEORM_MODULE)
    ) {
      return null;
    }
    switch (symbol.getName()) {
      case 'Repository':
        return 'repository';
      case 'DataSource':
        return 'data_source';
      case 'EntityManager':
        return 'entity_manager';
      default:
        return null;
    }
  };

  const analyzeTypeOrmRootType = (node: ts.Node): TypeOrmRootTypeAnalysis => {
    const type = input.checker.getTypeAtLocation(node);
    const members = type.isUnion() ? type.types : [type];
    const recognized: RecognizedTypeOrmRoot[] = [];
    let hasOther = false;
    for (const member of members) {
      if ((member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) !== 0) continue;
      const kind = rootKindForType(member);
      if (kind === null) hasOther = true;
      else recognized.push({ kind, type: member });
    }
    return { recognized, hasOther };
  };

  const repositoryEntityTargetsForType = (type: ts.Type): readonly LocatedEntity[] => {
    if ((type.flags & ts.TypeFlags.Object) === 0) return [];
    const typeArguments = input.checker.getTypeArguments(type as ts.TypeReference);
    return typeArguments[0] === undefined ? [] : entityCandidatesForType(typeArguments[0]);
  };

  const tableTargetsForEntities = (
    entities: readonly LocatedEntity[],
    status: QueryBuilderTableTarget['status'],
    source: QueryBuilderTableTarget['source'],
    evidenceIds: readonly string[],
  ): QueryBuilderTableTarget[] =>
    entities.flatMap((entity): QueryBuilderTableTarget[] =>
      entity.mapping === null
        ? []
        : [
            {
              table: entity.mapping.table,
              status,
              source,
              evidenceIds: [
                ...evidenceIds,
                classById.get(entity.entity.classId)!.declarationEvidenceId,
                ...entity.mapping.evidenceIds,
              ],
            },
          ],
    );

  const bindingsByClass = new Map<
    ts.ClassDeclaration,
    ReadonlyMap<string, ResolvedRepositoryBinding>
  >();
  for (const owner of classByNode.values()) {
    const constructor = constructorToAnalyze(owner.indexedClass);
    if (constructor === null) continue;
    const explicitAssignments = explicitParameterMemberAssignments(constructor, input.checker);
    const bindings = new Map<string, ResolvedRepositoryBinding>();

    for (const parameter of constructor.parameters) {
      const injectRepository = parameter.decorators.find((decorator) =>
        isPackageDecorator(decorator, NEST_TYPEORM_MODULE, 'InjectRepository'),
      );
      if (injectRepository === undefined) continue;
      const ownerRecord = ensureClassRecord(owner, ownerRoles(owner));
      const injectEvidenceId = addEvidence(
        createEvidenceForNode({
          sourceFile: owner.source.sourceFile,
          sourceFileRecord: owner.source.inventorySource.record,
          node: injectRepository.node,
          role: 'decorator',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      const memberBinding = memberBindingForParameter(parameter, explicitAssignments);
      if (memberBinding === null) {
        diagnostics.push(
          createDiagnostic({
            code: 'TYPEORM_ENTITY_UNRESOLVED',
            subjectId: ownerRecord.id,
            message: `Injected repository parameter ${owner.indexedClass.qualifiedName}.${parameter.name} is not a supported parameter property or direct constructor assignment.`,
            evidenceIds: [injectEvidenceId],
          }),
        );
        continue;
      }

      const declarationEvidenceId = addEvidence(
        createDeclarationEvidence(owner.source, parameter.node, input.evidenceSnippetLimit),
      );
      const resolutionEvidenceId = addEvidence(
        createEvidenceForNode({
          sourceFile: owner.source.sourceFile,
          sourceFileRecord: owner.source.inventorySource.record,
          node: memberBinding.resolutionNode,
          role: 'resolution_basis',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      const binding: RepositoryBindingRecord = {
        id: makeRepositoryBindingId(ownerRecord.id, memberBinding.memberName),
        ownerClassId: ownerRecord.id,
        memberName: memberBinding.memberName,
        declarationEvidenceId,
      };
      repositoryBindingById.set(binding.id, binding);
      const injectionAssertionId = makeAssertionId({
        subjectId: ownerRecord.id,
        predicate: 'CLASS_INJECTS_REPOSITORY',
        objectId: binding.id,
        ruleId: TYPEORM_REPOSITORY_INJECTION_RULE_ID,
      });
      addAssertion({
        id: injectionAssertionId,
        subjectId: ownerRecord.id,
        predicate: 'CLASS_INJECTS_REPOSITORY',
        objectId: binding.id,
        status: 'resolved',
        ruleId: TYPEORM_REPOSITORY_INJECTION_RULE_ID,
        evidenceIds: [injectEvidenceId, resolutionEvidenceId],
      });

      const injectExpression = injectRepository.node.expression;
      const entityArgument = ts.isCallExpression(injectExpression)
        ? injectExpression.arguments[0]
        : undefined;
      const entityArgumentEvidenceId =
        entityArgument === undefined
          ? null
          : addEvidence(
              createEvidenceForNode({
                sourceFile: owner.source.sourceFile,
                sourceFileRecord: owner.source.inventorySource.record,
                node: entityArgument,
                role: 'type_reference',
                snippetLimit: input.evidenceSnippetLimit,
              }),
            );
      const entityTargets = entityArgument === undefined ? [] : entityCandidatesFor(entityArgument);
      const entityEvidenceIds = [
        injectEvidenceId,
        ...(entityArgumentEvidenceId === null ? [] : [entityArgumentEvidenceId]),
      ];
      if (entityTargets.length === 0) {
        const assertionId = makeAssertionId({
          subjectId: binding.id,
          predicate: 'REPOSITORY_FOR_ENTITY',
          objectId: null,
          ruleId: TYPEORM_REPOSITORY_ENTITY_RULE_ID,
        });
        addAssertion({
          id: assertionId,
          subjectId: binding.id,
          predicate: 'REPOSITORY_FOR_ENTITY',
          objectId: null,
          status: 'unresolved',
          ruleId: TYPEORM_REPOSITORY_ENTITY_RULE_ID,
          evidenceIds: entityEvidenceIds,
        });
        diagnostics.push(
          createDiagnostic({
            code: 'TYPEORM_ENTITY_UNRESOLVED',
            subjectId: binding.id,
            message: `@InjectRepository entity for ${owner.indexedClass.qualifiedName}.${memberBinding.memberName} did not resolve to an in-repository @Entity class.`,
            evidenceIds: entityEvidenceIds,
          }),
        );
      } else {
        const status: AssertionStatus = entityTargets.length === 1 ? 'resolved' : 'ambiguous';
        for (const target of entityTargets) {
          const targetClassEvidenceId = classById.get(target.entity.classId)!.declarationEvidenceId;
          const assertionId = makeAssertionId({
            subjectId: binding.id,
            predicate: 'REPOSITORY_FOR_ENTITY',
            objectId: target.entity.id,
            ruleId: TYPEORM_REPOSITORY_ENTITY_RULE_ID,
          });
          addAssertion({
            id: assertionId,
            subjectId: binding.id,
            predicate: 'REPOSITORY_FOR_ENTITY',
            objectId: target.entity.id,
            status,
            ruleId: TYPEORM_REPOSITORY_ENTITY_RULE_ID,
            evidenceIds: [...entityEvidenceIds, targetClassEvidenceId],
          });
        }
      }

      bindings.set(memberBinding.memberName, {
        entityTargets,
        resolutionEvidenceId,
      });
    }
    if (bindings.size > 0) bindingsByClass.set(owner.indexedClass.node, bindings);
  }

  const queryBuilderRootsByClass = new Map<
    ts.ClassDeclaration,
    ReadonlyMap<string, QueryBuilderRootResolution>
  >();
  for (const owner of classByNode.values()) {
    const constructor = constructorToAnalyze(owner.indexedClass);
    if (constructor === null) continue;
    const explicitAssignments = explicitParameterMemberAssignments(constructor, input.checker);
    const roots = new Map<string, QueryBuilderRootResolution>();
    for (const parameter of constructor.parameters) {
      const memberBinding = memberBindingForParameter(parameter, explicitAssignments);
      if (memberBinding === null) continue;
      const typeAnalysis = analyzeTypeOrmRootType(parameter.node);
      if (typeAnalysis.recognized.length === 0) continue;
      const resolutionEvidenceId = evidenceForNode(
        memberBinding.resolutionNode,
        'resolution_basis',
      );
      const kinds = [...new Set(typeAnalysis.recognized.map(({ kind }) => kind))];
      if (typeAnalysis.hasOther || kinds.length !== 1) {
        roots.set(memberBinding.memberName, {
          status: 'ambiguous',
          message: `QueryBuilder receiver ${owner.indexedClass.qualifiedName}.${memberBinding.memberName} has both TypeORM and non-TypeORM or multiple TypeORM receiver possibilities.`,
          evidenceIds: [resolutionEvidenceId],
        });
        continue;
      }
      const recognized = typeAnalysis.recognized[0]!;
      const entityTargets =
        recognized.kind === 'repository'
          ? [
              ...new Set(
                typeAnalysis.recognized.flatMap(({ type }) => repositoryEntityTargetsForType(type)),
              ),
            ]
          : [];
      const status = entityTargets.length > 1 ? 'ambiguous' : 'resolved';
      roots.set(memberBinding.memberName, {
        status: 'resolved',
        kind: recognized.kind,
        tables: tableTargetsForEntities(entityTargets, status, 'repository', [
          resolutionEvidenceId,
        ]),
        evidenceIds: [resolutionEvidenceId],
      });
    }
    if (roots.size > 0) queryBuilderRootsByClass.set(owner.indexedClass.node, roots);
  }

  const targetResolutionFor = (expression: ts.Expression): QueryBuilderTargetResolution => {
    if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
      return {
        status: 'unsupported',
        targets: [],
        message: 'Callback QueryBuilder table sources and subqueries are outside the bounded flow.',
        evidenceIds: [evidenceForNode(expression, 'resolution_basis')],
      };
    }

    const entityTargets = entityCandidatesFor(expression);
    if (entityTargets.length > 0) {
      const expressionEvidenceId = evidenceForNode(expression, 'type_reference');
      const mappedTargets = tableTargetsForEntities(
        entityTargets,
        entityTargets.length === 1 ? 'resolved' : 'ambiguous',
        'entity',
        [expressionEvidenceId],
      );
      if (mappedTargets.length === 0) {
        return {
          status: 'unresolved',
          targets: [],
          message: 'The QueryBuilder entity target has no proven physical table mapping.',
          evidenceIds: [expressionEvidenceId],
        };
      }
      return {
        status: entityTargets.length === 1 ? 'resolved' : 'ambiguous',
        targets: mappedTargets,
        message:
          entityTargets.length === 1
            ? undefined
            : 'The QueryBuilder entity expression resolves to multiple possible entities.',
        evidenceIds: [
          expressionEvidenceId,
          ...mappedTargets.flatMap(({ evidenceIds }) => evidenceIds),
        ],
      };
    }

    const stringResolution = resolveSimpleString(expression, input.checker);
    const resolutionEvidenceIds = stringResolution.evidenceNodes.map((node) =>
      evidenceForNode(node, 'resolution_basis'),
    );
    if (stringResolution.status === 'resolved' && stringResolution.value.length > 0) {
      const table: TableRecord = {
        id: makeTableId(stringResolution.value, 'query_builder_literal'),
        name: stringResolution.value,
        nameSource: 'query_builder_literal',
      };
      return {
        status: 'resolved',
        targets: [
          {
            table,
            status: 'resolved',
            source: 'literal',
            evidenceIds: resolutionEvidenceIds,
          },
        ],
        evidenceIds: resolutionEvidenceIds,
      };
    }
    return {
      status: 'unresolved',
      targets: [],
      message: `The QueryBuilder table target is outside the supported entity or static-string boundary (${stringResolution.status === 'unsupported' ? stringResolution.reason : 'empty string'}).`,
      evidenceIds: resolutionEvidenceIds,
    };
  };

  for (const [ownerNode, bindings] of bindingsByClass) {
    const owner = classByNode.get(ownerNode)!;
    for (const sourceMethod of owner.indexedClass.methods) {
      const body = sourceMethod.node.body;
      if (body === undefined) continue;
      const visit = (node: ts.Node): void => {
        if (node !== body && isNestedThisBoundary(node)) return;
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const calledProperty = node.expression;
          const receiver = calledProperty.expression;
          if (isThisMember(receiver)) {
            const binding = bindings.get(receiver.name.text);
            if (binding !== undefined) {
              const sourceRecord = ensureMethodRecord({ ...owner, method: sourceMethod });
              const callEvidenceId = addEvidence(
                createEvidenceForNode({
                  sourceFile: owner.source.sourceFile,
                  sourceFileRecord: owner.source.inventorySource.record,
                  node,
                  role: 'call_site',
                  snippetLimit: input.evidenceSnippetLimit,
                }),
              );
              const operationName = calledProperty.name.text;
              if (operationName === 'createQueryBuilder' || operationName === 'query') {
                ts.forEachChild(node, visit);
                return;
              }
              const direction = repositoryOperation(operationName);
              if (direction === null) {
                diagnostics.push(
                  createDiagnostic({
                    code: 'TYPEORM_OPERATION_UNSUPPORTED',
                    subjectId: sourceRecord.id,
                    message: `TypeORM repository operation ${operationName} is outside the supported read/write catalogue.`,
                    evidenceIds: [callEvidenceId],
                  }),
                );
              } else {
                const predicate =
                  direction === 'read' ? 'METHOD_READS_TABLE' : 'METHOD_WRITES_TABLE';
                const status: AssertionStatus =
                  binding.entityTargets.length === 1 ? 'resolved' : 'ambiguous';
                let mappedTargetCount = 0;
                for (const target of binding.entityTargets) {
                  if (target.mapping === null) continue;
                  mappedTargetCount += 1;
                  const assertionId = makeAssertionId({
                    subjectId: sourceRecord.id,
                    predicate,
                    objectId: target.mapping.table.id,
                    ruleId: operationRuleId(operationName),
                  });
                  addAssertion({
                    id: assertionId,
                    subjectId: sourceRecord.id,
                    predicate,
                    objectId: target.mapping.table.id,
                    status,
                    ruleId: operationRuleId(operationName),
                    evidenceIds: [
                      callEvidenceId,
                      binding.resolutionEvidenceId,
                      ...target.mapping.evidenceIds,
                    ],
                  });
                }
                const valueArgument =
                  operationName === 'insert'
                    ? node.arguments[0]
                    : operationName === 'update'
                      ? node.arguments[1]
                      : undefined;
                if (valueArgument !== undefined && mappedTargetCount > 0) {
                  objectWriteSinks.push({
                    methodId: sourceRecord.id,
                    source: owner.source,
                    indexedClass: owner.indexedClass,
                    indexedMethod: sourceMethod,
                    kind: operationName === 'insert' ? 'repository_insert' : 'repository_update',
                    valueExpression: valueArgument,
                    entityTargets: binding.entityTargets.flatMap((target) =>
                      target.mapping === null
                        ? []
                        : [
                            {
                              entityId: target.entity.id,
                              status,
                              evidenceIds: [
                                binding.resolutionEvidenceId,
                                ...target.mapping.evidenceIds,
                              ],
                            },
                          ],
                    ),
                    operationEvidenceId: callEvidenceId,
                    evidenceIds: [callEvidenceId, binding.resolutionEvidenceId],
                  });
                }
                if (mappedTargetCount > 0 && IMPRECISE_COLUMN_OPERATIONS.has(operationName)) {
                  diagnostics.push(
                    createDiagnostic({
                      code: 'TYPEORM_SAVE_COLUMNS_UNKNOWN',
                      subjectId: sourceRecord.id,
                      message: `Repository.${operationName} proves a table write, but exact written columns are not proven.`,
                      evidenceIds: [callEvidenceId],
                    }),
                  );
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      ts.forEachChild(body, visit);
    }
  }

  for (const owner of classByNode.values()) {
    const memberRoots = queryBuilderRootsByClass.get(owner.indexedClass.node) ?? new Map();
    for (const sourceMethod of owner.indexedClass.methods) {
      const body = sourceMethod.node.body;
      if (body === undefined) continue;
      const queryBuilder = analyzeTypeOrmQueryBuilders({
        body,
        checker: input.checker,
        resolveRootReceiver(receiver) {
          if (isThisMember(receiver)) {
            const memberRoot = memberRoots.get(receiver.name.text);
            if (memberRoot !== undefined) return memberRoot;
          }
          const typeAnalysis = analyzeTypeOrmRootType(receiver);
          if (typeAnalysis.recognized.length === 0) return { status: 'ignored' };
          const kinds = [...new Set(typeAnalysis.recognized.map(({ kind }) => kind))];
          if (typeAnalysis.hasOther || kinds.length !== 1) {
            return {
              status: 'ambiguous',
              message:
                'The createQueryBuilder receiver has both TypeORM and non-TypeORM or multiple TypeORM receiver possibilities.',
              evidenceIds: [evidenceForNode(receiver, 'resolution_basis')],
            };
          }
          const kind = kinds[0]!;
          if (kind === 'repository') return { status: 'ignored' };
          return { status: 'resolved', kind, tables: [], evidenceIds: [] };
        },
        resolveTableTarget: targetResolutionFor,
        evidenceForNode,
      });
      if (
        queryBuilder.accesses.length === 0 &&
        queryBuilder.writeSinks.length === 0 &&
        queryBuilder.diagnostics.length === 0
      )
        continue;
      const sourceRecord = ensureMethodRecord({ ...owner, method: sourceMethod });
      for (const access of queryBuilder.accesses) {
        tableById.set(access.table.id, access.table);
        const predicate =
          access.direction === 'read' ? 'METHOD_READS_TABLE' : 'METHOD_WRITES_TABLE';
        const assertionId = makeAssertionId({
          subjectId: sourceRecord.id,
          predicate,
          objectId: access.table.id,
          ruleId: access.ruleId,
        });
        addAssertion({
          id: assertionId,
          subjectId: sourceRecord.id,
          predicate,
          objectId: access.table.id,
          status: access.status,
          ruleId: access.ruleId,
          evidenceIds: access.evidenceIds,
        });
      }
      for (const sink of queryBuilder.writeSinks) {
        const entities = [...locatedEntityByClassNode.values()].filter(
          ({ mapping }) => mapping?.table.id === sink.table.id,
        );
        objectWriteSinks.push({
          methodId: sourceRecord.id,
          source: owner.source,
          indexedClass: owner.indexedClass,
          indexedMethod: sourceMethod,
          kind: sink.kind,
          valueExpression: sink.valueExpression,
          entityTargets: entities.map((target) => ({
            entityId: target.entity.id,
            status: entities.length === 1 ? sink.status : 'ambiguous',
            evidenceIds: [...sink.evidenceIds, ...(target.mapping?.evidenceIds ?? [])],
          })),
          operationEvidenceId: sink.operationEvidenceId,
          evidenceIds: sink.evidenceIds,
        });
      }
      for (const diagnostic of queryBuilder.diagnostics) {
        diagnostics.push(
          createDiagnostic({
            code: diagnostic.code,
            subjectId: sourceRecord.id,
            message: diagnostic.message,
            evidenceIds: diagnostic.evidenceIds,
          }),
        );
      }
    }
  }

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    repositoryBindings: [...repositoryBindingById.values()],
    entities: [...entityById.values()],
    tables: [...tableById.values()],
    columnMetadata,
    entityColumns: [...entityColumnById.values()],
    objectWriteSinks,
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics,
  };
}

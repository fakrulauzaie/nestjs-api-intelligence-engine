import { resolve } from 'node:path';
import ts from 'typescript';
import { createDiagnostic } from '../diagnostics/catalogue.js';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type { DiagnosticRecord } from '../model/diagnostics.js';
import type { ClassRecord, ClassRole, MethodRecord } from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import { makeAssertionId } from '../model/ids.js';
import { resolveSimpleString } from '../ts-index/constants.js';
import type {
  IndexedClass,
  IndexedMethod,
  IndexedParameter,
  IndexedSourceFile,
  SourceIndex,
} from '../ts-index/source-index.js';
import { resolveAliasedSymbol } from '../ts-index/symbols.js';
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

export const CLASS_INJECTION_RULE_ID = 'nest.di.class-constructor.v1';
export const DIRECT_CALL_RULE_ID = 'nest.call.injected-member.v1';

const NEST_COMMON_MODULE = '@nestjs/common';
const NEST_TYPEORM_MODULE = '@nestjs/typeorm';
const EXTERNALLY_MODELED_CONSTRUCTOR_TYPES = new Map([
  ['@nestjs/axios', 'HttpService'],
  ['@nestjs/config', 'ConfigService'],
  ['@nestjs/event-emitter', 'EventEmitter2'],
]);

export interface ClassRelationshipExtraction {
  readonly classes: readonly ClassRecord[];
  readonly methods: readonly MethodRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly diagnostics: readonly DiagnosticRecord[];
  /** Internal resolved/ambiguous call sites consumed by provenance analysis. */
  readonly directMethodCalls: readonly DirectMethodCallObservation[];
}

export interface DirectMethodCallObservation {
  readonly sourceMethodId: string;
  readonly targetMethodId: string;
  readonly source: IndexedSourceFile;
  readonly sourceClass: IndexedClass;
  readonly sourceMethod: IndexedMethod;
  readonly targetSource: IndexedSourceFile;
  readonly targetClass: IndexedClass;
  readonly targetMethod: IndexedMethod;
  readonly call: ts.CallExpression;
  readonly status: 'resolved' | 'ambiguous';
  readonly callEvidenceId: string;
  readonly resolutionEvidenceId: string;
}

interface LocatedClass {
  readonly source: IndexedSourceFile;
  readonly indexedClass: IndexedClass;
}

interface LocatedMethod extends LocatedClass {
  readonly method: IndexedMethod;
}

interface MemberBinding {
  readonly memberName: string;
  readonly targetClasses: readonly LocatedClass[];
  readonly resolutionEvidenceId: string;
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function nestedFunctionBoundary(node: ts.Node, root: ts.MethodDeclaration): boolean {
  return node !== root && ts.isFunctionLike(node);
}

function externallyModeledConstructorType(
  parameter: IndexedParameter,
  checker: ts.TypeChecker,
): boolean {
  const typeNode = parameter.node.type;
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return false;
  const symbol = resolveAliasedSymbol(checker, checker.getSymbolAtLocation(typeNode.typeName));
  if (symbol === null) return false;
  for (const [moduleSpecifier, className] of EXTERNALLY_MODELED_CONSTRUCTOR_TYPES) {
    if (
      symbol.name === className &&
      (symbol.declarations ?? []).some((declaration) =>
        declarationBelongsToPackage(declaration.getSourceFile().fileName, moduleSpecifier),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function extractClassRelationships(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
}): ClassRelationshipExtraction {
  const classByNode = new Map<ts.ClassDeclaration, LocatedClass>();
  const methodByNode = new Map<ts.MethodDeclaration, LocatedMethod>();
  const sourceByAbsolutePath = new Map<string, IndexedSourceFile>();
  for (const source of input.sourceIndex.sourceFiles) {
    sourceByAbsolutePath.set(absolutePathKey(source.sourceFile.fileName), source);
    for (const indexedClass of source.classes) {
      const locatedClass = { source, indexedClass };
      classByNode.set(indexedClass.node, locatedClass);
      for (const method of indexedClass.methods) {
        methodByNode.set(method.node, { ...locatedClass, method });
      }
    }
  }

  const evidenceById = new Map<string, EvidenceRecord>();
  const classById = new Map<string, ClassRecord>();
  const methodById = new Map<string, MethodRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const diagnostics: DiagnosticRecord[] = [];
  const directMethodCalls: DirectMethodCallObservation[] = [];
  const bindingsByClass = new Map<ts.ClassDeclaration, ReadonlyMap<string, MemberBinding>>();

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
    const owner = ensureClassRecord(located, []);
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

  const classCandidatesFor = (parameter: IndexedParameter): readonly LocatedClass[] => {
    const typeNode = parameter.node.type;
    if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return [];
    const symbol = resolveAliasedSymbol(
      input.checker,
      input.checker.getSymbolAtLocation(typeNode.typeName),
    );
    if (symbol === null) return [];
    return [
      ...new Set(
        (symbol.declarations ?? [])
          .filter(ts.isClassDeclaration)
          .map((declaration) => classByNode.get(declaration))
          .filter((located) => located !== undefined),
      ),
    ];
  };

  const tokenResolutionEvidence = (parameter: IndexedParameter): readonly string[] => {
    const injectDecorator = parameter.decorators.find((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Inject'),
    );
    if (injectDecorator === undefined || !ts.isCallExpression(injectDecorator.node.expression)) {
      return [];
    }
    const argument = injectDecorator.node.expression.arguments[0];
    if (argument === undefined) return [];
    const resolution = resolveSimpleString(argument, input.checker);
    return resolution.evidenceNodes.filter(ts.isVariableDeclaration).flatMap((node) => {
      const source = sourceByAbsolutePath.get(absolutePathKey(node.getSourceFile().fileName));
      return source === undefined
        ? []
        : [
            addEvidence(
              createEvidenceForNode({
                sourceFile: source.sourceFile,
                sourceFileRecord: source.inventorySource.record,
                node,
                role: 'resolution_basis',
                snippetLimit: input.evidenceSnippetLimit,
              }),
            ),
          ];
    });
  };

  const recognizedOwners: LocatedClass[] = [];
  for (const located of classByNode.values()) {
    const isController = located.indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Controller'),
    );
    const isProvider = located.indexedClass.decorators.some((decorator) =>
      isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Injectable'),
    );
    if (!isController && !isProvider) continue;
    recognizedOwners.push(located);
    ensureClassRecord(located, [
      ...(isController ? (['controller'] as const) : []),
      ...(isProvider ? (['provider'] as const) : []),
    ]);
  }

  for (const owner of recognizedOwners) {
    const constructor = constructorToAnalyze(owner.indexedClass);
    if (constructor === null) continue;
    const explicitAssignments = explicitParameterMemberAssignments(constructor, input.checker);
    const memberBindings = new Map<string, MemberBinding>();

    for (const parameter of constructor.parameters) {
      const ownerRecord = ensureClassRecord(owner, []);
      const injectDecorator = parameter.decorators.find((decorator) =>
        isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Inject'),
      );
      const injectRepositoryDecorator = parameter.decorators.find((decorator) =>
        isPackageDecorator(decorator, NEST_TYPEORM_MODULE, 'InjectRepository'),
      );
      if (
        injectRepositoryDecorator !== undefined ||
        externallyModeledConstructorType(parameter, input.checker)
      ) {
        continue;
      }
      const parameterEvidenceId = addEvidence(
        createEvidenceForNode({
          sourceFile: owner.source.sourceFile,
          sourceFileRecord: owner.source.inventorySource.record,
          node: parameter.node.type ?? parameter.node,
          role: 'type_reference',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      if (injectDecorator !== undefined) {
        const decoratorEvidenceId = addEvidence(
          createEvidenceForNode({
            sourceFile: owner.source.sourceFile,
            sourceFileRecord: owner.source.inventorySource.record,
            node: injectDecorator.node,
            role: 'decorator',
            snippetLimit: input.evidenceSnippetLimit,
          }),
        );
        diagnostics.push(
          createDiagnostic({
            code: 'DI_TOKEN_UNSUPPORTED',
            subjectId: ownerRecord.id,
            message: `Injection token for ${owner.indexedClass.qualifiedName}.${parameter.name} is outside class-only constructor injection.`,
            evidenceIds: [
              decoratorEvidenceId,
              parameterEvidenceId,
              ...tokenResolutionEvidence(parameter),
            ],
          }),
        );
        continue;
      }

      const targetClasses = classCandidatesFor(parameter);
      if (targetClasses.length === 0) {
        diagnostics.push(
          createDiagnostic({
            code: 'DI_TOKEN_UNSUPPORTED',
            subjectId: ownerRecord.id,
            message: `Constructor parameter ${owner.indexedClass.qualifiedName}.${parameter.name} does not resolve to one in-repository class declaration.`,
            evidenceIds: [parameterEvidenceId],
          }),
        );
        continue;
      }

      for (const target of targetClasses) {
        const targetRecord = ensureClassRecord(target, ['provider']);
        const assertionId = makeAssertionId({
          subjectId: ownerRecord.id,
          predicate: 'CLASS_INJECTS_CLASS',
          objectId: targetRecord.id,
          ruleId: CLASS_INJECTION_RULE_ID,
        });
        addAssertion({
          id: assertionId,
          subjectId: ownerRecord.id,
          predicate: 'CLASS_INJECTS_CLASS',
          objectId: targetRecord.id,
          status: targetClasses.length === 1 ? 'resolved' : 'ambiguous',
          ruleId: CLASS_INJECTION_RULE_ID,
          evidenceIds: [parameterEvidenceId],
        });
      }

      const memberBinding = memberBindingForParameter(parameter, explicitAssignments);
      if (memberBinding === null) continue;
      const resolutionEvidenceId = addEvidence(
        createEvidenceForNode({
          sourceFile: owner.source.sourceFile,
          sourceFileRecord: owner.source.inventorySource.record,
          node: memberBinding.resolutionNode,
          role: 'resolution_basis',
          snippetLimit: input.evidenceSnippetLimit,
        }),
      );
      memberBindings.set(memberBinding.memberName, {
        memberName: memberBinding.memberName,
        targetClasses,
        resolutionEvidenceId,
      });
    }
    bindingsByClass.set(owner.indexedClass.node, memberBindings);
  }

  for (const owner of recognizedOwners) {
    const bindings = bindingsByClass.get(owner.indexedClass.node);
    if (bindings === undefined || bindings.size === 0) continue;

    for (const sourceMethod of owner.indexedClass.methods) {
      const body = sourceMethod.node.body;
      if (body === undefined) continue;
      const visit = (node: ts.Node): void => {
        if (nestedFunctionBoundary(node, sourceMethod.node)) return;
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
              const calledSymbol = resolveAliasedSymbol(
                input.checker,
                input.checker.getSymbolAtLocation(calledProperty.name),
              );
              const targets = [
                ...new Set(
                  (calledSymbol?.declarations ?? [])
                    .filter(ts.isMethodDeclaration)
                    .map((declaration) => methodByNode.get(declaration))
                    .filter((located) => located !== undefined),
                ),
              ];
              if (targets.length === 0) {
                diagnostics.push(
                  createDiagnostic({
                    code: 'CALL_TARGET_UNRESOLVED',
                    subjectId: sourceRecord.id,
                    message: `Direct call target ${owner.indexedClass.qualifiedName}.${sourceMethod.name} -> ${binding.memberName}.${calledProperty.name.text} could not be resolved to an in-repository method declaration.`,
                    evidenceIds: [callEvidenceId, binding.resolutionEvidenceId],
                  }),
                );
              } else {
                for (const target of targets) {
                  ensureClassRecord(target, ['provider']);
                  const targetRecord = ensureMethodRecord(target);
                  const assertionId = makeAssertionId({
                    subjectId: sourceRecord.id,
                    predicate: 'METHOD_CALLS_METHOD',
                    objectId: targetRecord.id,
                    ruleId: DIRECT_CALL_RULE_ID,
                  });
                  addAssertion({
                    id: assertionId,
                    subjectId: sourceRecord.id,
                    predicate: 'METHOD_CALLS_METHOD',
                    objectId: targetRecord.id,
                    status: targets.length === 1 ? 'resolved' : 'ambiguous',
                    ruleId: DIRECT_CALL_RULE_ID,
                    evidenceIds: [callEvidenceId, binding.resolutionEvidenceId],
                  });
                  directMethodCalls.push({
                    sourceMethodId: sourceRecord.id,
                    targetMethodId: targetRecord.id,
                    source: owner.source,
                    sourceClass: owner.indexedClass,
                    sourceMethod,
                    targetSource: target.source,
                    targetClass: target.indexedClass,
                    targetMethod: target.method,
                    call: node,
                    status: targets.length === 1 ? 'resolved' : 'ambiguous',
                    callEvidenceId,
                    resolutionEvidenceId: binding.resolutionEvidenceId,
                  });
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

  return {
    classes: [...classById.values()],
    methods: [...methodById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
    diagnostics,
    directMethodCalls,
  };
}

import { resolve } from 'node:path';
import ts from 'typescript';
import { createEvidenceForNode } from '../evidence/locations.js';
import type { AssertionRecord } from '../model/assertions.js';
import type {
  ContractFieldRecord,
  ContractShapeSource,
  ContractTypeRecord,
  DeclaredConstraint,
  DeclaredTypeShape,
  RequestParameterRecord,
  RequestSourceKind,
  ResponseContractRecord,
} from '../model/entities.js';
import type { EvidenceRecord } from '../model/evidence.js';
import {
  makeAssertionId,
  makeContractFieldId,
  makeContractTypeId,
  makeMethodId,
  makeRequestParameterId,
  makeResponseContractId,
} from '../model/ids.js';
import { resolveDecorators, type ResolvedDecoratorIdentity } from '../ts-index/decorators.js';
import type { IndexedSourceFile, SourceIndex } from '../ts-index/source-index.js';
import { resolveAliasedSymbol } from '../ts-index/symbols.js';
import { createDeclarationEvidence } from './canonical-records.js';
import type { NestEndpointDeclaration } from './nest-routes.js';
import { declarationBelongsToPackage, isPackageDecorator } from './package-symbols.js';

export const NEST_REQUEST_PARAMETER_RULE_ID = 'nest.request-parameter.v1';
export const NEST_RESPONSE_CONTRACT_RULE_ID = 'nest.response-contract.v1';
export const TYPESCRIPT_CONTRACT_FIELD_RULE_ID = 'typescript.contract-field.v1';

const NEST_COMMON_MODULE = '@nestjs/common';
const CLASS_VALIDATOR_MODULE = 'class-validator';
const REQUEST_DECORATORS: Readonly<Record<string, RequestSourceKind>> = {
  Body: 'body',
  Param: 'param',
  Query: 'query',
};

export interface NestContractExtraction {
  readonly contractTypes: readonly ContractTypeRecord[];
  readonly contractFields: readonly ContractFieldRecord[];
  readonly requestParameters: readonly RequestParameterRecord[];
  readonly responseContracts: readonly ResponseContractRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly evidence: readonly EvidenceRecord[];
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function qualifiedDeclarationName(
  declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
): string {
  const segments = [declaration.name?.text ?? '<anonymous>'];
  let current: ts.Node = declaration.parent;
  while (!ts.isSourceFile(current)) {
    if (ts.isModuleDeclaration(current)) segments.unshift(current.name.getText());
    current = current.parent;
  }
  return segments.join('.');
}

function isPrimitive(type: ts.Type): boolean {
  return (
    (type.flags &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.Null |
        ts.TypeFlags.Undefined)) !==
    0
  );
}

function callArguments(decorator: ResolvedDecoratorIdentity): readonly ts.Expression[] {
  const expression = decorator.node.expression;
  return ts.isCallExpression(expression) ? expression.arguments : [];
}

export function extractNestContracts(input: {
  sourceIndex: SourceIndex;
  checker: ts.TypeChecker;
  endpointDeclarations: readonly NestEndpointDeclaration[];
  repositoryRevision: string | null;
  evidenceSnippetLimit: number;
}): NestContractExtraction {
  const sourceByAbsolutePath = new Map(
    input.sourceIndex.sourceFiles.map((source) => [
      absolutePathKey(source.sourceFile.fileName),
      source,
    ]),
  );
  const evidenceById = new Map<string, EvidenceRecord>();
  const contractTypeById = new Map<string, ContractTypeRecord>();
  const contractTypeIdByDeclaration = new Map<ts.Declaration, string>();
  const contractFieldById = new Map<string, ContractFieldRecord>();
  const requestParameterById = new Map<string, RequestParameterRecord>();
  const responseContractById = new Map<string, ResponseContractRecord>();
  const assertionById = new Map<string, AssertionRecord>();
  const buildingContractTypes = new Set<string>();
  const builtContractTypes = new Set<string>();

  const addEvidence = (record: EvidenceRecord): string => {
    evidenceById.set(record.id, record);
    return record.id;
  };
  const sourceFor = (node: ts.Node): IndexedSourceFile | null =>
    sourceByAbsolutePath.get(absolutePathKey(node.getSourceFile().fileName)) ?? null;
  const evidenceFor = (node: ts.Node, role: EvidenceRecord['role']): string | null => {
    const source = sourceFor(node);
    if (source === null) return null;
    return addEvidence(
      createEvidenceForNode({
        sourceFile: source.sourceFile,
        sourceFileRecord: source.inventorySource.record,
        node,
        role,
        snippetLimit: input.evidenceSnippetLimit,
      }),
    );
  };
  const addAssertion = (record: AssertionRecord): void => {
    const existing = assertionById.get(record.id);
    assertionById.set(
      record.id,
      existing === undefined
        ? record
        : {
            ...existing,
            evidenceIds: [...new Set([...existing.evidenceIds, ...record.evidenceIds])],
          },
    );
  };

  const declarationForType = (
    type: ts.Type,
  ): ts.ClassDeclaration | ts.InterfaceDeclaration | null => {
    const symbol = resolveAliasedSymbol(input.checker, type.aliasSymbol ?? type.getSymbol());
    for (const declaration of symbol?.declarations ?? []) {
      if (
        (ts.isClassDeclaration(declaration) || ts.isInterfaceDeclaration(declaration)) &&
        sourceFor(declaration) !== null
      ) {
        return declaration;
      }
    }
    return null;
  };

  const typeForDeclaration = (
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
  ): ts.Type => {
    const symbol =
      declaration.name === undefined
        ? undefined
        : input.checker.getSymbolAtLocation(declaration.name);
    return symbol === undefined
      ? input.checker.getTypeAtLocation(declaration)
      : input.checker.getDeclaredTypeOfSymbol(symbol);
  };

  const contractShapeSource = (
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
  ): ContractShapeSource => {
    const hasDerivedHeritage =
      declaration.heritageClauses?.some((clause) =>
        clause.types.some((heritage) => ts.isCallExpression(heritage.expression)),
      ) ?? false;
    return hasDerivedHeritage ? 'checker_derived' : 'declarations';
  };

  const ensureContractTypeForDeclaration = (
    declaration: ts.ClassDeclaration | ts.InterfaceDeclaration,
    suppliedType?: ts.Type,
  ): ContractTypeRecord | null => {
    const source = sourceFor(declaration);
    if (source === null || declaration.name === undefined) return null;
    const qualifiedName = qualifiedDeclarationName(declaration);
    const id = makeContractTypeId({
      path: source.inventorySource.record.path,
      qualifiedName,
      repositoryRevision: input.repositoryRevision,
    });
    contractTypeIdByDeclaration.set(declaration, id);
    let record = contractTypeById.get(id);
    if (record === undefined) {
      const declarationEvidenceId = addEvidence(
        createDeclarationEvidence(source, declaration, input.evidenceSnippetLimit),
      );
      record = {
        id,
        sourceFileId: source.inventorySource.record.id,
        qualifiedName,
        displayName: declaration.name.text,
        declarationKind: ts.isClassDeclaration(declaration) ? 'class' : 'interface',
        shapeSource: contractShapeSource(declaration),
        declarationEvidenceId,
      };
      contractTypeById.set(id, record);
    }
    if (buildingContractTypes.has(id) || builtContractTypes.has(id)) return record;
    buildingContractTypes.add(id);

    const effectiveType = suppliedType ?? typeForDeclaration(declaration);
    for (const property of input.checker.getPropertiesOfType(effectiveType)) {
      const propertyDeclaration = (property.declarations ?? []).find(
        (candidate): candidate is ts.PropertyDeclaration | ts.PropertySignature =>
          (ts.isPropertyDeclaration(candidate) || ts.isPropertySignature(candidate)) &&
          sourceFor(candidate) !== null,
      );
      const ownerDeclaration = propertyDeclaration?.parent;
      const declaringContract =
        ownerDeclaration !== undefined &&
        (ts.isClassDeclaration(ownerDeclaration) || ts.isInterfaceDeclaration(ownerDeclaration))
          ? ensureContractTypeForDeclaration(ownerDeclaration)
          : null;
      const inherited = declaringContract !== null && declaringContract.id !== id;
      const fieldShapeSource: ContractShapeSource =
        record.shapeSource === 'checker_derived' || propertyDeclaration === undefined
          ? 'checker_derived'
          : 'declarations';
      const location = propertyDeclaration ?? declaration;
      const propertyType = input.checker.getTypeOfSymbolAtLocation(property, location);
      const declarationEvidenceId =
        propertyDeclaration === undefined ? null : evidenceFor(propertyDeclaration, 'declaration');
      const declaredConstraints: DeclaredConstraint[] = [];
      if (propertyDeclaration !== undefined) {
        for (const decorator of resolveDecorators(propertyDeclaration, input.checker)) {
          if (
            decorator.moduleSpecifier !== CLASS_VALIDATOR_MODULE ||
            decorator.symbol === null ||
            !declarationBelongsToPackage(decorator.declarationFile, CLASS_VALIDATOR_MODULE)
          ) {
            continue;
          }
          const decoratorEvidenceId = evidenceFor(decorator.node, 'decorator');
          if (decoratorEvidenceId === null) continue;
          declaredConstraints.push({
            name: decorator.exportedName,
            argumentTexts: callArguments(decorator).map((argument) => argument.getText()),
            decoratorEvidenceId,
          });
        }
      }
      const fieldId = makeContractFieldId(id, property.getName());
      const field: ContractFieldRecord = {
        id: fieldId,
        contractTypeId: id,
        declaringContractTypeId: declaringContract?.id ?? null,
        name: property.getName(),
        typeText: input.checker.typeToString(
          propertyType,
          location,
          ts.TypeFormatFlags.NoTruncation,
        ),
        optional:
          (property.flags & ts.SymbolFlags.Optional) !== 0 ||
          propertyDeclaration?.questionToken !== undefined,
        readonly:
          propertyDeclaration?.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword,
          ) ?? false,
        inherited,
        shapeSource: fieldShapeSource,
        declarationEvidenceId,
        declaredConstraints,
      };
      contractFieldById.set(fieldId, field);
      const assertionId = makeAssertionId({
        subjectId: id,
        predicate: 'CONTRACT_TYPE_DECLARES_FIELD',
        objectId: fieldId,
        ruleId: TYPESCRIPT_CONTRACT_FIELD_RULE_ID,
      });
      addAssertion({
        id: assertionId,
        subjectId: id,
        predicate: 'CONTRACT_TYPE_DECLARES_FIELD',
        objectId: fieldId,
        status: declarationEvidenceId === null ? 'unsupported' : 'resolved',
        ruleId: TYPESCRIPT_CONTRACT_FIELD_RULE_ID,
        evidenceIds:
          declarationEvidenceId === null
            ? [record.declarationEvidenceId]
            : [
                declarationEvidenceId,
                ...declaredConstraints.map((item) => item.decoratorEvidenceId),
              ],
      });
    }

    buildingContractTypes.delete(id);
    builtContractTypes.add(id);
    return record;
  };

  const ensureContractType = (type: ts.Type): ContractTypeRecord | null => {
    const declaration = declarationForType(type);
    return declaration === null ? null : ensureContractTypeForDeclaration(declaration, type);
  };

  const typeText = (type: ts.Type, context: ts.Node): string =>
    input.checker.typeToString(type, context, ts.TypeFormatFlags.NoTruncation);

  const declaredTypeShape = (
    type: ts.Type,
    context: ts.Node,
    source: DeclaredTypeShape['source'],
    preferredText?: string,
  ): DeclaredTypeShape => {
    const displayed = preferredText ?? typeText(type, context);
    if ((type.flags & ts.TypeFlags.Any) !== 0) {
      return { typeText: displayed, kind: 'any', source, alternatives: [], contractTypeIds: [] };
    }
    if ((type.flags & ts.TypeFlags.Unknown) !== 0) {
      return {
        typeText: displayed,
        kind: 'unknown',
        source,
        alternatives: [],
        contractTypeIds: [],
      };
    }
    if ((type.flags & ts.TypeFlags.Void) !== 0) {
      return { typeText: displayed, kind: 'void', source, alternatives: [], contractTypeIds: [] };
    }
    if (type.isUnion()) {
      const alternatives = type.types.map((member) => typeText(member, context));
      const contractTypeIds = type.types.flatMap((member) => {
        const contract = ensureContractType(member);
        return contract === null ? [] : [contract.id];
      });
      return {
        typeText: displayed,
        kind: 'union',
        source,
        alternatives,
        contractTypeIds: [...new Set(contractTypeIds)],
      };
    }
    if (input.checker.isArrayType(type)) {
      const elementType = input.checker.getTypeArguments(type as ts.TypeReference)[0];
      const contract = elementType === undefined ? null : ensureContractType(elementType);
      return {
        typeText: displayed,
        kind: 'array',
        source,
        alternatives: elementType === undefined ? [] : [typeText(elementType, context)],
        contractTypeIds: contract === null ? [] : [contract.id],
      };
    }
    if (isPrimitive(type)) {
      return {
        typeText: displayed,
        kind: 'primitive',
        source,
        alternatives: [],
        contractTypeIds: [],
      };
    }
    const contract = ensureContractType(type);
    if (contract !== null) {
      return {
        typeText: displayed,
        kind: 'contract',
        source,
        alternatives: [],
        contractTypeIds: [contract.id],
      };
    }
    const typeArguments =
      (type.flags & ts.TypeFlags.Object) !== 0 &&
      ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
        ? input.checker.getTypeArguments(type as ts.TypeReference)
        : [];
    return {
      typeText: displayed,
      kind: typeArguments.length > 0 ? 'complex_generic' : 'unknown',
      source,
      alternatives: [],
      contractTypeIds: [],
    };
  };

  const responseType = (
    method: ts.MethodDeclaration,
  ): { outerTypeText: string; promiseUnwrapped: boolean; shape: DeclaredTypeShape } => {
    const signature = input.checker.getSignatureFromDeclaration(method);
    const inferred = signature?.getReturnType() ?? input.checker.getTypeAtLocation(method);
    const source = method.type === undefined ? 'checker_derived' : 'declared';
    const outer = method.type?.getText() ?? typeText(inferred, method);
    const symbol = resolveAliasedSymbol(
      input.checker,
      inferred.aliasSymbol ?? inferred.getSymbol(),
    );
    const isPromise = symbol?.getName() === 'Promise';
    const typeArguments =
      isPromise &&
      (inferred.flags & ts.TypeFlags.Object) !== 0 &&
      ((inferred as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
        ? input.checker.getTypeArguments(inferred as ts.TypeReference)
        : [];
    const normalized = typeArguments.length === 1 ? typeArguments[0]! : inferred;
    return {
      outerTypeText: outer,
      promiseUnwrapped: typeArguments.length === 1,
      shape: declaredTypeShape(normalized, method.type ?? method, source),
    };
  };

  for (const endpoint of input.endpointDeclarations) {
    const method = endpoint.indexedMethod.node;
    const methodId = makeMethodId({
      path: endpoint.source.inventorySource.record.path,
      qualifiedClassName: endpoint.indexedClass.qualifiedName,
      methodName: endpoint.indexedMethod.name,
      signature: endpoint.indexedMethod.signature,
      repositoryRevision: input.repositoryRevision,
    });

    let manualResponseEvidenceId: string | null = null;
    for (const [parameterIndex, parameter] of method.parameters.entries()) {
      for (const decorator of resolveDecorators(parameter, input.checker)) {
        if (isPackageDecorator(decorator, NEST_COMMON_MODULE, 'Res')) {
          manualResponseEvidenceId = evidenceFor(decorator.node, 'decorator');
        }
        const sourceKind = REQUEST_DECORATORS[decorator.exportedName];
        if (
          sourceKind === undefined ||
          !isPackageDecorator(decorator, NEST_COMMON_MODULE, decorator.exportedName)
        ) {
          continue;
        }
        const declarationEvidenceId = evidenceFor(parameter, 'declaration');
        const decoratorEvidenceId = evidenceFor(decorator.node, 'decorator');
        if (declarationEvidenceId === null || decoratorEvidenceId === null) continue;
        const args = callArguments(decorator);
        const selector =
          args[0] !== undefined &&
          (ts.isStringLiteral(args[0]) || ts.isNoSubstitutionTemplateLiteral(args[0]))
            ? args[0].text
            : null;
        const selectorState =
          args.length === 0 ? 'whole' : selector === null ? 'unknown' : 'literal';
        const parameterType =
          parameter.type === undefined
            ? input.checker.getTypeAtLocation(parameter)
            : input.checker.getTypeFromTypeNode(parameter.type);
        const id = makeRequestParameterId({ methodId, parameterIndex, sourceKind });
        const record: RequestParameterRecord = {
          id,
          methodId,
          parameterIndex,
          parameterName: parameter.name.getText(),
          sourceKind,
          selector,
          selectorState,
          optional: parameter.questionToken !== undefined || parameter.initializer !== undefined,
          declaredType: declaredTypeShape(
            parameterType,
            parameter.type ?? parameter,
            parameter.type === undefined ? 'checker_derived' : 'declared',
            parameter.type?.getText(),
          ),
          declarationEvidenceId,
          decoratorEvidenceId,
        };
        requestParameterById.set(id, record);
        const assertionId = makeAssertionId({
          subjectId: methodId,
          predicate: 'METHOD_DECLARES_REQUEST_PARAMETER',
          objectId: id,
          ruleId: NEST_REQUEST_PARAMETER_RULE_ID,
        });
        addAssertion({
          id: assertionId,
          subjectId: methodId,
          predicate: 'METHOD_DECLARES_REQUEST_PARAMETER',
          objectId: id,
          status: 'resolved',
          ruleId: NEST_REQUEST_PARAMETER_RULE_ID,
          evidenceIds: [declarationEvidenceId, decoratorEvidenceId],
        });
      }
    }

    const response = responseType(method);
    const declarationEvidenceId =
      evidenceFor(method.type ?? method, 'declaration') ??
      addEvidence(createDeclarationEvidence(endpoint.source, method, input.evidenceSnippetLimit));
    const responseId = makeResponseContractId(methodId);
    responseContractById.set(responseId, {
      id: responseId,
      methodId,
      handling: manualResponseEvidenceId === null ? 'return_value' : 'manual',
      outerTypeText: response.outerTypeText,
      promiseUnwrapped: response.promiseUnwrapped,
      declaredType: response.shape,
      declarationEvidenceId,
      manualResponseEvidenceId,
    });
    const assertionId = makeAssertionId({
      subjectId: methodId,
      predicate: 'METHOD_DECLARES_RESPONSE',
      objectId: responseId,
      ruleId: NEST_RESPONSE_CONTRACT_RULE_ID,
    });
    addAssertion({
      id: assertionId,
      subjectId: methodId,
      predicate: 'METHOD_DECLARES_RESPONSE',
      objectId: responseId,
      status: 'resolved',
      ruleId: NEST_RESPONSE_CONTRACT_RULE_ID,
      evidenceIds: [
        declarationEvidenceId,
        ...(manualResponseEvidenceId === null ? [] : [manualResponseEvidenceId]),
      ],
    });
  }

  return {
    contractTypes: [...contractTypeById.values()],
    contractFields: [...contractFieldById.values()],
    requestParameters: [...requestParameterById.values()],
    responseContracts: [...responseContractById.values()],
    assertions: [...assertionById.values()],
    evidence: [...evidenceById.values()],
  };
}

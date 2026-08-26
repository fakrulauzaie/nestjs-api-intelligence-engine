import ts from 'typescript';
import type {
  IndexedClass,
  IndexedConstructor,
  IndexedParameter,
} from '../ts-index/source-index.js';

export interface ConstructorMemberBinding {
  readonly memberName: string;
  readonly resolutionNode: ts.Node;
}

export function isThisMember(node: ts.Expression): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword;
}

function isParameterProperty(parameter: ts.ParameterDeclaration): boolean {
  return (
    parameter.modifiers?.some((modifier) =>
      [
        ts.SyntaxKind.PublicKeyword,
        ts.SyntaxKind.ProtectedKeyword,
        ts.SyntaxKind.PrivateKeyword,
        ts.SyntaxKind.ReadonlyKeyword,
      ].includes(modifier.kind),
    ) ?? false
  );
}

function assignmentExpression(statement: ts.Statement): ts.BinaryExpression | null {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
    return null;
  }
  return statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ? statement.expression
    : null;
}

export function explicitParameterMemberAssignments(
  constructor: IndexedConstructor,
  checker: ts.TypeChecker,
): ReadonlyMap<ts.ParameterDeclaration, ts.BinaryExpression> {
  const body = constructor.node.body;
  if (body === undefined) return new Map();

  const allAssignmentsByMember = new Map<string, ts.BinaryExpression[]>();
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isThisMember(node.left)
    ) {
      const assignments = allAssignmentsByMember.get(node.left.name.text) ?? [];
      assignments.push(node);
      allAssignmentsByMember.set(node.left.name.text, assignments);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);

  const directCandidates = new Map<ts.ParameterDeclaration, ts.BinaryExpression[]>();
  for (const statement of body.statements) {
    const assignment = assignmentExpression(statement);
    if (
      assignment === null ||
      !isThisMember(assignment.left) ||
      !ts.isIdentifier(assignment.right)
    ) {
      continue;
    }
    const rightSymbol = checker.getSymbolAtLocation(assignment.right);
    for (const parameter of constructor.parameters) {
      if (parameter.symbol !== null && rightSymbol === parameter.symbol) {
        const candidates = directCandidates.get(parameter.node) ?? [];
        candidates.push(assignment);
        directCandidates.set(parameter.node, candidates);
      }
    }
  }

  const unique = new Map<ts.ParameterDeclaration, ts.BinaryExpression>();
  const memberCounts = new Map<string, number>();
  for (const [parameter, candidates] of directCandidates) {
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    if (
      candidate === undefined ||
      !isThisMember(candidate.left) ||
      allAssignmentsByMember.get(candidate.left.name.text)?.length !== 1
    ) {
      continue;
    }
    unique.set(parameter, candidate);
    memberCounts.set(
      candidate.left.name.text,
      (memberCounts.get(candidate.left.name.text) ?? 0) + 1,
    );
  }

  for (const [parameter, candidate] of unique) {
    if (isThisMember(candidate.left) && memberCounts.get(candidate.left.name.text) !== 1) {
      unique.delete(parameter);
    }
  }
  return unique;
}

export function constructorToAnalyze(indexedClass: IndexedClass): IndexedConstructor | null {
  const withBody = indexedClass.constructors.filter(
    (constructor) => constructor.node.body !== undefined,
  );
  if (withBody.length === 1) return withBody[0]!;
  return indexedClass.constructors.length === 1 ? indexedClass.constructors[0]! : null;
}

export function memberBindingForParameter(
  parameter: IndexedParameter,
  explicitAssignments: ReadonlyMap<ts.ParameterDeclaration, ts.BinaryExpression>,
): ConstructorMemberBinding | null {
  if (isParameterProperty(parameter.node) && ts.isIdentifier(parameter.node.name)) {
    return { memberName: parameter.node.name.text, resolutionNode: parameter.node };
  }

  const assignment = explicitAssignments.get(parameter.node);
  return assignment !== undefined && isThisMember(assignment.left)
    ? { memberName: assignment.left.name.text, resolutionNode: assignment }
    : null;
}

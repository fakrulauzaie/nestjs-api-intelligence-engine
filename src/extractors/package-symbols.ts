import type {
  ResolvedDecoratorIdentity,
  ResolvedImportedExpressionIdentity,
} from '../ts-index/decorators.js';
import { isImportedDecorator } from '../ts-index/decorators.js';

export function declarationBelongsToPackage(
  declarationFile: string | null,
  moduleSpecifier: string,
): boolean {
  return (
    declarationFile
      ?.replaceAll('\\', '/')
      .includes(`/node_modules/${moduleSpecifier.replaceAll('\\', '/')}/`) ?? false
  );
}

export function isPackageDecorator(
  identity: ResolvedDecoratorIdentity,
  moduleSpecifier: string,
  exportedName: string,
): boolean {
  return (
    isImportedDecorator(identity, moduleSpecifier, exportedName) &&
    declarationBelongsToPackage(identity.declarationFile, moduleSpecifier)
  );
}

export function isPackageExpression(
  identity: ResolvedImportedExpressionIdentity,
  moduleSpecifier: string,
  exportedName: string,
): boolean {
  return (
    identity.moduleSpecifier === moduleSpecifier &&
    identity.exportedName === exportedName &&
    identity.symbol !== null &&
    declarationBelongsToPackage(identity.declarationFile, moduleSpecifier)
  );
}

import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import type { DiagnosticCode } from '../model/diagnostics.js';
import { normalizeRepositoryRelativePath } from '../model/paths.js';
import { RepositoryInputError } from '../scanner/errors.js';
import type { RepositoryInventory } from '../scanner/inventory.js';

export const TYPESCRIPT_DIAGNOSTIC_ORIGINS = [
  'configuration',
  'options',
  'global',
  'syntactic',
  'semantic',
] as const;
export type TypeScriptDiagnosticOrigin = (typeof TYPESCRIPT_DIAGNOSTIC_ORIGINS)[number];

export const TYPESCRIPT_DIAGNOSTIC_CATEGORIES = [
  'warning',
  'error',
  'suggestion',
  'message',
] as const;
export type TypeScriptDiagnosticCategory = (typeof TYPESCRIPT_DIAGNOSTIC_CATEGORIES)[number];

export interface TypeScriptProjectDiagnostic {
  readonly typescriptCode: number;
  readonly category: TypeScriptDiagnosticCategory;
  readonly origin: TypeScriptDiagnosticOrigin;
  readonly message: string;
  readonly filePath: string | null;
  readonly startLine: number | null;
  readonly startColumn: number | null;
  readonly endLine: number | null;
  readonly endColumn: number | null;
  readonly canonicalCode: DiagnosticCode | null;
}

export interface TypeScriptProject {
  readonly repositoryRoot: string;
  readonly tsconfigPath: string;
  readonly parsedCommandLine: ts.ParsedCommandLine;
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly diagnostics: readonly TypeScriptProjectDiagnostic[];
  readonly targetSourceCacheHits: number;
}

export interface LoadTypeScriptProjectOptions {
  readonly repositoryRoot: string;
  readonly inventory: RepositoryInventory;
  readonly tsconfigPath?: string;
}

const IMPORT_UNRESOLVED_CODES = new Set([2307, 2792, 7016]);

function isContainedPath(root: string, candidate: string): boolean {
  const relativePath = relative(root, candidate);
  return (
    relativePath === '' ||
    (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`))
  );
}

function absolutePathKey(filePath: string): string {
  const absolute = resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

export async function resolveTsconfigPath(
  repositoryRoot: string,
  configuredPath?: string,
): Promise<string> {
  const absoluteRoot = resolve(repositoryRoot);
  const candidate = resolve(absoluteRoot, configuredPath ?? 'tsconfig.json');

  if (!isContainedPath(absoluteRoot, candidate)) {
    throw new RepositoryInputError(
      'TSCONFIG_OUTSIDE_REPOSITORY',
      `TypeScript configuration must stay inside the repository: ${candidate}`,
    );
  }

  let metadata;
  try {
    metadata = await stat(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      throw new RepositoryInputError(
        'TSCONFIG_UNREADABLE',
        `TypeScript configuration cannot be inspected: ${candidate}`,
      );
    }
    throw new RepositoryInputError(
      'TSCONFIG_NOT_FOUND',
      `TypeScript configuration does not exist: ${candidate}`,
    );
  }

  if (!metadata.isFile()) {
    throw new RepositoryInputError(
      'TSCONFIG_NOT_FILE',
      `TypeScript configuration is not a file: ${candidate}`,
    );
  }

  const realRoot = await realpath(absoluteRoot);
  const realConfig = await realpath(candidate);
  if (!isContainedPath(realRoot, realConfig)) {
    throw new RepositoryInputError(
      'TSCONFIG_OUTSIDE_REPOSITORY',
      `TypeScript configuration symlink resolves outside the repository: ${candidate}`,
    );
  }

  return ts.sys.resolvePath(candidate).replaceAll('\\', '/');
}

function categoryName(category: ts.DiagnosticCategory): TypeScriptDiagnosticCategory {
  switch (category) {
    case ts.DiagnosticCategory.Warning:
      return 'warning';
    case ts.DiagnosticCategory.Error:
      return 'error';
    case ts.DiagnosticCategory.Suggestion:
      return 'suggestion';
    case ts.DiagnosticCategory.Message:
      return 'message';
    default:
      return 'message';
  }
}

function canonicalDiagnosticCode(
  diagnostic: ts.Diagnostic,
  origin: TypeScriptDiagnosticOrigin,
): DiagnosticCode | null {
  if (origin === 'configuration' || origin === 'syntactic') {
    return 'TS_PARSE_ERROR';
  }
  return IMPORT_UNRESOLVED_CODES.has(diagnostic.code) ? 'TS_IMPORT_UNRESOLVED' : null;
}

function mapDiagnostic(
  diagnostic: ts.Diagnostic,
  origin: TypeScriptDiagnosticOrigin,
  repositoryRoot: string,
): TypeScriptProjectDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const sourceFile = diagnostic.file;
  const startOffset = diagnostic.start;

  let filePath: string | null = null;
  let startLine: number | null = null;
  let startColumn: number | null = null;
  let endLine: number | null = null;
  let endColumn: number | null = null;

  if (sourceFile !== undefined) {
    try {
      filePath = normalizeRepositoryRelativePath(repositoryRoot, sourceFile.fileName);
    } catch {
      filePath = null;
    }
  }

  if (sourceFile !== undefined && startOffset !== undefined) {
    const start = sourceFile.getLineAndCharacterOfPosition(startOffset);
    const end = sourceFile.getLineAndCharacterOfPosition(startOffset + (diagnostic.length ?? 0));
    startLine = start.line + 1;
    startColumn = start.character + 1;
    endLine = end.line + 1;
    endColumn = end.character + 1;
  }

  return {
    typescriptCode: diagnostic.code,
    category: categoryName(diagnostic.category),
    origin,
    message,
    filePath,
    startLine,
    startColumn,
    endLine,
    endColumn,
    canonicalCode: canonicalDiagnosticCode(diagnostic, origin),
  };
}

function scriptKindForFile(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (fileName.endsWith('.mts')) return ts.ScriptKind.TS;
  if (fileName.endsWith('.cts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.TS;
}

function isDeclarationFilePath(fileName: string): boolean {
  return /\.d\.(?:ts|mts|cts)$/i.test(fileName);
}

function isCompilerInputPath(fileName: string): boolean {
  return /\.[cm]?[jt]sx?$/i.test(fileName);
}

function isNodeModulesPath(fileName: string): boolean {
  const absolute = resolve(fileName);
  return absolute.toLowerCase().includes(`${sep}node_modules${sep}`.toLowerCase());
}

function deduplicateDiagnostics(
  diagnostics: readonly TypeScriptProjectDiagnostic[],
): TypeScriptProjectDiagnostic[] {
  const byIdentity = new Map<string, TypeScriptProjectDiagnostic>();
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.origin,
      diagnostic.typescriptCode,
      diagnostic.filePath,
      diagnostic.startLine,
      diagnostic.startColumn,
      diagnostic.message,
    ].join(':');
    byIdentity.set(key, diagnostic);
  }
  return [...byIdentity.values()].sort((left, right) =>
    `${left.filePath ?? ''}:${left.startLine ?? 0}:${left.typescriptCode}:${left.origin}`.localeCompare(
      `${right.filePath ?? ''}:${right.startLine ?? 0}:${right.typescriptCode}:${right.origin}`,
    ),
  );
}

export async function loadTypeScriptProject(
  options: LoadTypeScriptProjectOptions,
): Promise<TypeScriptProject> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const tsconfigPath = await resolveTsconfigPath(repositoryRoot, options.tsconfigPath);
  const configuration = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

  if (configuration.error !== undefined) {
    const diagnostic = mapDiagnostic(configuration.error, 'configuration', repositoryRoot);
    if (configuration.error.code === 5083) {
      throw new RepositoryInputError(
        'TSCONFIG_UNREADABLE',
        `TypeScript configuration cannot be read: ${tsconfigPath}`,
        [diagnostic.message],
      );
    }
    throw new RepositoryInputError(
      'TSCONFIG_INVALID',
      `TypeScript configuration could not be parsed: ${tsconfigPath}`,
      [diagnostic.message],
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configuration.config,
    ts.sys,
    dirname(tsconfigPath),
    { noEmit: true, incremental: false, composite: false },
    tsconfigPath,
  );

  if ((parsed.projectReferences?.length ?? 0) > 0) {
    throw new RepositoryInputError(
      'TSCONFIG_PROJECT_REFERENCES_UNSUPPORTED',
      'TypeScript project references are outside the single-application MVP scope.',
    );
  }

  const inventoryByAbsolutePath = new Map(
    options.inventory.sourceFiles.map((source) => [absolutePathKey(source.absolutePath), source]),
  );

  for (const fileName of parsed.fileNames) {
    const absoluteFileName = resolve(fileName);
    if (!isContainedPath(repositoryRoot, absoluteFileName)) {
      throw new RepositoryInputError(
        'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY',
        `TypeScript configuration includes source outside the repository: ${fileName}`,
      );
    }
    if (!inventoryByAbsolutePath.has(absolutePathKey(absoluteFileName))) {
      throw new RepositoryInputError(
        'TSCONFIG_SOURCE_EXCLUDED',
        `TypeScript configuration includes a source file excluded by the safe inventory: ${fileName}`,
      );
    }
  }

  const compilerOptions: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    incremental: false,
    composite: false,
  };
  const host = ts.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const blockedSources = new Map<
    string,
    'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY' | 'TSCONFIG_SOURCE_EXCLUDED'
  >();
  let targetSourceCacheHits = 0;

  const blockedSourceCode = (
    fileName: string,
  ): 'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY' | 'TSCONFIG_SOURCE_EXCLUDED' | null => {
    if (
      !isCompilerInputPath(fileName) ||
      isDeclarationFilePath(fileName) ||
      isNodeModulesPath(fileName) ||
      inventoryByAbsolutePath.has(absolutePathKey(fileName))
    ) {
      return null;
    }
    return isContainedPath(repositoryRoot, resolve(fileName))
      ? 'TSCONFIG_SOURCE_EXCLUDED'
      : 'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY';
  };

  const noteBlockedSource = (fileName: string): boolean => {
    const code = blockedSourceCode(fileName);
    if (code === null) return false;
    blockedSources.set(resolve(fileName), code);
    return true;
  };

  host.readFile = (fileName) => {
    const source = inventoryByAbsolutePath.get(absolutePathKey(fileName));
    if (source !== undefined) {
      targetSourceCacheHits += 1;
      return source.text;
    }
    if (noteBlockedSource(fileName)) return undefined;
    return originalReadFile(fileName);
  };

  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = inventoryByAbsolutePath.get(absolutePathKey(fileName));
    if (source !== undefined) {
      targetSourceCacheHits += 1;
      return ts.createSourceFile(
        fileName,
        source.text,
        languageVersion,
        true,
        scriptKindForFile(fileName),
      );
    }
    if (noteBlockedSource(fileName)) return undefined;
    return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
  };

  host.writeFile = () => {
    throw new Error('Analyzer compiler host must never emit target repository output.');
  };

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: compilerOptions,
    host,
  });

  const blockedSource = [...blockedSources.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )[0];
  if (blockedSource !== undefined) {
    const [fileName, code] = blockedSource;
    throw new RepositoryInputError(
      code,
      code === 'TSCONFIG_SOURCE_EXCLUDED'
        ? `TypeScript resolved a source file excluded by the safe inventory: ${fileName}`
        : `TypeScript resolved non-declaration source outside the repository: ${fileName}`,
    );
  }

  for (const sourceFile of program.getSourceFiles()) {
    const absoluteFileName = resolve(sourceFile.fileName);
    if (
      !sourceFile.isDeclarationFile &&
      !isContainedPath(repositoryRoot, absoluteFileName) &&
      !absoluteFileName.includes(`${sep}node_modules${sep}`)
    ) {
      throw new RepositoryInputError(
        'TSCONFIG_SOURCE_OUTSIDE_REPOSITORY',
        `TypeScript resolved non-declaration source outside the repository: ${sourceFile.fileName}`,
      );
    }
  }

  const diagnostics = deduplicateDiagnostics([
    ...parsed.errors.map((diagnostic) =>
      mapDiagnostic(diagnostic, 'configuration', repositoryRoot),
    ),
    ...program
      .getOptionsDiagnostics()
      .map((diagnostic) => mapDiagnostic(diagnostic, 'options', repositoryRoot)),
    ...program
      .getGlobalDiagnostics()
      .map((diagnostic) => mapDiagnostic(diagnostic, 'global', repositoryRoot)),
    ...program
      .getSyntacticDiagnostics()
      .map((diagnostic) => mapDiagnostic(diagnostic, 'syntactic', repositoryRoot)),
    ...program
      .getSemanticDiagnostics()
      .map((diagnostic) => mapDiagnostic(diagnostic, 'semantic', repositoryRoot)),
  ]);

  return {
    repositoryRoot,
    tsconfigPath,
    parsedCommandLine: parsed,
    program,
    checker: program.getTypeChecker(),
    diagnostics,
    targetSourceCacheHits,
  };
}

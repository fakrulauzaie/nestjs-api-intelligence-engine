import type { AnalysisDocument } from '../model/analysis.js';

export interface ModuleVisibilityEntry {
  readonly moduleId: string;
  readonly controllerClassIds: readonly string[];
  readonly ownProviderClassIds: readonly string[];
  readonly importedProviderClassIds: readonly string[];
  readonly globalProviderClassIds: readonly string[];
  readonly visibleProviderClassIds: readonly string[];
  readonly complete: boolean;
}

export interface ModuleVisibilityView {
  readonly availability: 'available' | 'unavailable';
  readonly modules: readonly ModuleVisibilityEntry[];
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function buildModuleVisibility(analysis: AnalysisDocument): ModuleVisibilityView {
  if (analysis.schemaVersion === '1.0.0') return { availability: 'unavailable', modules: [] };

  const imports = new Map<string, string[]>();
  const exportsClasses = new Map<string, string[]>();
  const exportsModules = new Map<string, string[]>();
  const providers = new Map<string, string[]>();
  const controllers = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, value: string): void => {
    map.set(key, [...(map.get(key) ?? []), value]);
  };
  for (const assertion of analysis.assertions) {
    if (assertion.status !== 'resolved' || assertion.objectId === null) continue;
    switch (assertion.predicate) {
      case 'MODULE_IMPORTS_MODULE':
        add(imports, assertion.subjectId, assertion.objectId);
        break;
      case 'MODULE_EXPORTS_CLASS':
        add(exportsClasses, assertion.subjectId, assertion.objectId);
        break;
      case 'MODULE_EXPORTS_MODULE':
        add(exportsModules, assertion.subjectId, assertion.objectId);
        break;
      case 'MODULE_PROVIDES_CLASS':
        add(providers, assertion.subjectId, assertion.objectId);
        break;
      case 'MODULE_DECLARES_CONTROLLER':
        add(controllers, assertion.subjectId, assertion.objectId);
        break;
      default:
        break;
    }
  }

  const moduleById = new Map(
    analysis.modules.map((moduleRecord) => [moduleRecord.id, moduleRecord]),
  );
  const exportedByModule = new Map(
    analysis.modules.map((moduleRecord) => [
      moduleRecord.id,
      new Set(exportsClasses.get(moduleRecord.id) ?? []),
    ]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const moduleRecord of analysis.modules) {
      const exported = exportedByModule.get(moduleRecord.id)!;
      for (const exportedModuleId of exportsModules.get(moduleRecord.id) ?? []) {
        for (const classId of exportedByModule.get(exportedModuleId) ?? []) {
          if (exported.has(classId)) continue;
          exported.add(classId);
          changed = true;
        }
      }
    }
  }

  const globalProviders = new Set<string>();
  for (const moduleRecord of analysis.modules.filter(({ isGlobal }) => isGlobal)) {
    for (const classId of exportedByModule.get(moduleRecord.id) ?? []) {
      globalProviders.add(classId);
    }
  }

  const completenessMemo = new Map<string, boolean>();
  const moduleComplete = (moduleId: string, visiting = new Set<string>()): boolean => {
    const cached = completenessMemo.get(moduleId);
    if (cached !== undefined) return cached;
    if (visiting.has(moduleId)) return true;
    const moduleRecord = moduleById.get(moduleId);
    if (moduleRecord === undefined || moduleRecord.metadataCompleteness === 'incomplete') {
      return false;
    }
    const next = new Set([...visiting, moduleId]);
    const complete = (imports.get(moduleId) ?? []).every((id) => moduleComplete(id, next));
    completenessMemo.set(moduleId, complete);
    return complete;
  };

  return {
    availability: 'available',
    modules: analysis.modules
      .map((moduleRecord): ModuleVisibilityEntry => {
        const imported = new Set<string>();
        for (const importedModuleId of imports.get(moduleRecord.id) ?? []) {
          for (const classId of exportedByModule.get(importedModuleId) ?? []) {
            imported.add(classId);
          }
        }
        const own = new Set(providers.get(moduleRecord.id) ?? []);
        return {
          moduleId: moduleRecord.id,
          controllerClassIds: sorted(controllers.get(moduleRecord.id) ?? []),
          ownProviderClassIds: sorted(own),
          importedProviderClassIds: sorted(imported),
          globalProviderClassIds: sorted(globalProviders),
          visibleProviderClassIds: sorted([...own, ...imported, ...globalProviders]),
          complete: moduleComplete(moduleRecord.id),
        };
      })
      .sort((left, right) => left.moduleId.localeCompare(right.moduleId)),
  };
}

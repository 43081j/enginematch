import browserslist from 'browserslist';
import {
  minVersion as semverMinVersion,
  intersects as semverIntersects,
  coerce as semverCoerce,
  gte,
  lte
} from 'semver';

export interface EngineConstraint {
  engine: string;
  minVersion?: string;
  maxVersion?: string;
}

export interface PackageJson {
  engines?: Record<string, string>;
  browserslist?: string | string[] | Record<string, string | string[]>;
}

function parse_browserslist(
  queries: PackageJson['browserslist']
): Map<string, string[]> {
  if (queries === undefined) return new Map();

  let query_list: string[];

  if (typeof queries === 'string') {
    query_list = [queries];
  } else if (Array.isArray(queries)) {
    query_list = queries;
  } else {
    throw new Error(
      'Unsupported browserslist format: ' + JSON.stringify(queries)
    );
  }

  if (query_list.length === 0) return new Map();

  const resolved = browserslist(query_list);
  const map = new Map<string, string[]>();

  for (const entry of resolved) {
    const idx = entry.indexOf(' ');
    if (idx === -1) continue;
    const family = entry.slice(0, idx);
    const version = entry.slice(idx + 1);
    const existing = map.get(family);
    if (existing) {
      existing.push(version);
    } else {
      map.set(family, [version]);
    }
  }

  return map;
}

export function satisfies(
  pkg: PackageJson,
  options: {requirements: EngineConstraint[]}
): boolean {
  const {requirements} = options;
  const browser_map = parse_browserslist(pkg.browserslist);
  const engines = pkg.engines ?? {};

  for (const constraint of requirements) {
    const {engine, minVersion, maxVersion} = constraint;

    if (!minVersion && !maxVersion) continue;

    const engine_range = engines[engine];
    const browser_versions = browser_map.get(engine);

    // If the engine is not targeted at all (not in engines, not in browserslist),
    // the constraint is trivially satisfied — the project doesn't target this engine.
    if (!engine_range && !browser_versions) continue;

    // Check semver engine range (e.g. node >=18)
    if (engine_range) {
      if (minVersion) {
        const lowest = semverMinVersion(engine_range);
        const coerced_min = semverCoerce(minVersion);
        if (!lowest || !coerced_min || !gte(lowest, coerced_min)) {
          return false;
        }
      }
      if (maxVersion) {
        if (semverIntersects(engine_range, '>' + maxVersion)) {
          return false;
        }
      }
    }

    // Check browserslist-resolved versions
    if (browser_versions) {
      for (let version of browser_versions) {
        // Safari Technology Preview — resolve to the actual latest safari version
        if (version === 'TP') {
          const latest = browserslist('last 1 safari version')[0];
          if (!latest) continue;
          version = latest.slice(latest.indexOf(' ') + 1);
        }

        // Handle range versions like "17.5-17.6"
        const parts = version.split('-');
        const low = parts[0]!;
        const high = parts[parts.length - 1]!;

        if (minVersion) {
          const coerced = semverCoerce(low);
          const coerced_min = semverCoerce(minVersion);
          if (!coerced || !coerced_min || !gte(coerced, coerced_min)) {
            return false;
          }
        }

        if (maxVersion) {
          const coerced = semverCoerce(high);
          const coerced_max = semverCoerce(maxVersion);
          if (!coerced || !coerced_max || !lte(coerced, coerced_max)) {
            return false;
          }
        }
      }
    }
  }

  return true;
}

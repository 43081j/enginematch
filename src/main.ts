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

/**
 * Pick the right environment from an env-keyed browserslist config object.
 * Mirrors the logic of browserslist's internal `pickEnv`.
 */
function pick_env(
  config: Record<string, string | string[]>,
  env?: string
): string | string[] | undefined {
  const name =
    env ?? process.env.BROWSERSLIST_ENV ?? process.env.NODE_ENV ?? 'production';

  return config[name] ?? config['defaults'];
}

/**
 * Resolve browserslist queries from the package.json `browserslist` field,
 * or by finding a config file (.browserslistrc, browserslist) via the
 * `browserslist` package's built-in config resolution.
 *
 * When `pkg_browserslist` is undefined and `cwd` is set, `browserslist()`
 * automatically discovers and reads config files (.browserslistrc,
 * browserslist, package.json) by walking parent directories from `path`.
 */
function resolve_browserslist(
  pkg_browserslist: PackageJson['browserslist'],
  cwd?: string,
  env?: string
): Map<string, string[]> {
  const bl_options: browserslist.LoadConfigOptions = {};

  if (env) {
    bl_options.env = env;
  }

  if (cwd) {
    bl_options.path = cwd;
  }

  let queries: string | string[] | undefined;

  if (pkg_browserslist !== undefined) {
    if (
      typeof pkg_browserslist === 'string' ||
      Array.isArray(pkg_browserslist)
    ) {
      queries = pkg_browserslist;
    } else {
      // Record<string, string | string[]> — env-keyed config
      const selected = pick_env(pkg_browserslist, env);
      if (selected === undefined) return new Map();
      queries = typeof selected === 'string' ? [selected] : selected;
    }
  }

  if (
    (typeof queries === 'string' && queries.trim() === '') ||
    (Array.isArray(queries) && queries.length === 0)
  ) {
    // No inline browserslist pass undefined queries so browserslist() resolves from the config file via `path`.
    queries = undefined;
  }

  const resolved = browserslist(queries, bl_options);
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

export interface SatisfiesOptions {
  requirements: EngineConstraint[];
  /**
   * Working directory to search for `.browserslistrc` or `browserslist`
   * config files when the package.json does not contain a `browserslist` key.
   */
  cwd?: string;
  /**
   * The browserslist environment to use when the config is env-keyed
   * (e.g. `{ production: [...], development: [...] }`).
   * Falls back to `BROWSERSLIST_ENV`, `NODE_ENV`, or `"production"`.
   */
  env?: string;
}

const ENGINE_ALIASES: Array<readonly string[]> = [['node', 'nodejs']];

function compute_engine_names(engine: string): readonly string[] {
  for (const group of ENGINE_ALIASES) {
    if (group.includes(engine)) {
      return group;
    }
  }
  return [engine];
}

export function satisfies(
  pkg: PackageJson,
  options: SatisfiesOptions
): boolean {
  const {requirements, cwd, env} = options;
  const browser_map = resolve_browserslist(pkg.browserslist, cwd, env);
  const engines = pkg.engines ?? {};

  for (const constraint of requirements) {
    const {engine, minVersion, maxVersion} = constraint;

    if (!minVersion && !maxVersion) continue;

    const aliases = compute_engine_names(engine);
    let engine_range: string | undefined;
    let browser_versions: string[] | undefined;
    for (const alias of aliases) {
      if (!engine_range && Object.hasOwn(engines, alias)) {
        engine_range = engines[alias];
      }
      if (!browser_versions) {
        browser_versions = browser_map.get(alias);
      }
      if (browser_versions && engine_range) {
        break;
      }
    }

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

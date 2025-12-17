import browserslist from 'browserslist';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {up as findPackage} from 'empathic/package';
import {satisfies as semverSatisfies, intersects as semverIntersects} from 'semver';

export interface Options {
  cwd: string;
  overrideBrowsersList?: string[];
}

interface PackageJsonLike {
  engines?: Record<string, string>;
}

async function tryReadPackageJson(cwd: string): Promise<PackageJsonLike | null> {
  const packageLocation = findPackage({cwd});
  if (packageLocation) {
    try {
      const pkgContent = await readFile(packageLocation, 'utf-8');
      return JSON.parse(pkgContent);
    } catch {
      return null;
    }
  }
  return null;
}

export interface Version {
  browserslist?: string;
  minimum?: string;
  maximum?: string;
}

export type VersionSpec = Record<string, Version>;

export async function satisfies(spec: VersionSpec, opts: Options): Promise<boolean> {
  const browsers = browserslist(opts.overrideBrowsersList, {
    path: path.join(opts.cwd, 'package.json'),
  })

  const engines = new Map<string, string>();
  const pkg = await tryReadPackageJson(opts.cwd);

  if (pkg && Object.hasOwn(pkg, 'engines') && pkg.engines) {
    for (const [engine, version] of Object.entries<string>(pkg.engines)) {
      if (typeof version === 'string') {
        engines.set(engine, version);
      }
    }
  }

  for (const [engine, versionReq] of Object.entries<Version>(spec)) {
    let browserslistVersions: string[] | undefined;

    if (versionReq.browserslist) {
      browserslistVersions = browserslist(versionReq.browserslist);
    }

    const engineRange = engines.get(engine);

    // If the engine isn't specified and there is no browserlist requirement,
    // it is satisfied
    if (!engineRange && !browserslistVersions) {
      continue;
    }

    if (browserslistVersions) {
      const allSatisfied = browserslistVersions.every(version => browsers.includes(version));
      if (!allSatisfied) {
        return false;
      }
    }

    if (engineRange) {
      if (versionReq.minimum && !semverSatisfies(versionReq.minimum, engineRange)) {
        return false;
      }

      if (versionReq.maximum && semverIntersects(engineRange, '>' + versionReq.maximum)) {
        return false;
      }
    }
  }

  return false;
}

satisfies({
  node: {minimum: '14.0.0'},
}, {
  cwd: process.cwd(),
});

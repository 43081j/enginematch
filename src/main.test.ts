import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {satisfies, resolve} from './main.js';
import {mkdtempSync, writeFileSync, mkdirSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

describe('satisfies', () => {
  describe('trivial / base cases', () => {
    it('returns true for empty requirements array', () => {
      expect(satisfies({}, {requirements: []})).toBe(true);
    });

    it('returns true for requirement with neither minVersion nor maxVersion', () => {
      expect(
        satisfies({engines: {node: '>=18'}}, {requirements: [{engine: 'node'}]})
      ).toBe(true);
    });

    it('returns true when pkg has no engines and no browserslist', () => {
      expect(
        satisfies({}, {requirements: [{engine: 'node', minVersion: '14.0.0'}]})
      ).toBe(true);
    });

    it('returns true when pkg is empty and requirements have both min and max', () => {
      expect(
        satisfies(
          {},
          {
            requirements: [
              {engine: 'chrome', minVersion: '80', maxVersion: '120'}
            ]
          }
        )
      ).toBe(true);
    });
  });

  describe('engine constraints (pkg.engines)', () => {
    it('returns true when engine is not in pkg.engines (not targeted)', () => {
      expect(
        satisfies(
          {engines: {node: '>=18'}},
          {
            requirements: [{engine: 'deno', minVersion: '1.0.0'}]
          }
        )
      ).toBe(true);
    });

    it('returns true when engine range satisfies minVersion', () => {
      // node >=18 means minimum targeted is 18.0.0, which is >= 14.0.0
      expect(
        satisfies(
          {engines: {node: '>=18'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(true);
    });

    it('returns false when engine range does not satisfy minVersion', () => {
      // node >=12 means minimum targeted is 12.0.0, which is < 14.0.0
      expect(
        satisfies(
          {engines: {node: '>=12'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(false);
    });

    it('returns true when engine range is exactly at minVersion', () => {
      expect(
        satisfies(
          {engines: {node: '>=14'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(true);
    });

    it('returns true when engine range satisfies maxVersion', () => {
      // node >=12 <18 — does not include anything > 18.0.0
      expect(
        satisfies(
          {engines: {node: '>=12 <18'}},
          {
            requirements: [{engine: 'node', maxVersion: '18.0.0'}]
          }
        )
      ).toBe(true);
    });

    it('returns false when engine range exceeds maxVersion', () => {
      // node >=12 includes versions > 18.0.0
      expect(
        satisfies(
          {engines: {node: '>=12'}},
          {
            requirements: [{engine: 'node', maxVersion: '18.0.0'}]
          }
        )
      ).toBe(false);
    });

    it('handles both minVersion and maxVersion on same constraint', () => {
      // node >=14 <20 — min is 14 (>= 14), no intersection with >20
      expect(
        satisfies(
          {engines: {node: '>=14 <20'}},
          {
            requirements: [
              {engine: 'node', minVersion: '14.0.0', maxVersion: '20.0.0'}
            ]
          }
        )
      ).toBe(true);

      // node >=12 <20 — min is 12 (< 14), fails minVersion
      expect(
        satisfies(
          {engines: {node: '>=12 <20'}},
          {
            requirements: [
              {engine: 'node', minVersion: '14.0.0', maxVersion: '20.0.0'}
            ]
          }
        )
      ).toBe(false);
    });

    it('handles union ranges with ||', () => {
      // 14 || 16 || 18 — minVersion is 14.0.0
      expect(
        satisfies(
          {engines: {node: '14 || 16 || 18'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(true);

      // 12 || 14 || 16 — minVersion is 12.0.0, which is < 14.0.0
      expect(
        satisfies(
          {engines: {node: '12 || 14 || 16'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(false);
    });

    it('handles complex semver ranges', () => {
      expect(
        satisfies(
          {engines: {node: '>=12 <20'}},
          {
            requirements: [{engine: 'node', minVersion: '10.0.0'}]
          }
        )
      ).toBe(true);

      expect(
        satisfies(
          {engines: {node: '>=12 <20'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(false);
    });

    it('handles exact version in engines', () => {
      expect(
        satisfies(
          {engines: {node: '18.0.0'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(true);

      expect(
        satisfies(
          {engines: {node: '12.0.0'}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(false);
    });
  });

  describe('engine name aliases (node / nodejs)', () => {
    it('matches engines.node against a "nodejs" requirement', () => {
      expect(
        satisfies(
          {engines: {node: '>=18'}},
          {requirements: [{engine: 'nodejs', minVersion: '14.0.0'}]}
        )
      ).toBe(true);
    });

    it('matches engines.nodejs against a "node" requirement', () => {
      expect(
        satisfies(
          {engines: {nodejs: '>=18'}},
          {requirements: [{engine: 'node', minVersion: '14.0.0'}]}
        )
      ).toBe(true);
    });

    it('returns false when engines.node does not satisfy a "nodejs" requirement', () => {
      expect(
        satisfies(
          {engines: {node: '>=16'}},
          {requirements: [{engine: 'nodejs', minVersion: '20.0.0'}]}
        )
      ).toBe(false);
    });

    it('returns false when engines.nodejs does not satisfy a "node" requirement', () => {
      expect(
        satisfies(
          {engines: {nodejs: '>=16'}},
          {requirements: [{engine: 'node', minVersion: '20.0.0'}]}
        )
      ).toBe(false);
    });

    it('matches browserslist node family against a "nodejs" requirement', () => {
      expect(
        satisfies(
          {browserslist: ['node 20']},
          {requirements: [{engine: 'nodejs', minVersion: '18.0.0'}]}
        )
      ).toBe(true);
    });

    it('returns false when browserslist node family is below a "nodejs" requirement', () => {
      expect(
        satisfies(
          {browserslist: ['node 16']},
          {requirements: [{engine: 'nodejs', minVersion: '20.0.0'}]}
        )
      ).toBe(false);
    });

    it('does not alias unrelated engine names', () => {
      // a `chrome` requirement must not pick up engines.node
      expect(
        satisfies(
          {engines: {node: '>=18'}},
          {requirements: [{engine: 'chrome', minVersion: '100.0.0'}]}
        )
      ).toBe(true); // trivially satisfied — chrome not targeted
    });
  });

  describe('browserslist constraints — string[] format', () => {
    it('returns true when all resolved browsers satisfy minVersion', () => {
      expect(
        satisfies(
          {browserslist: ['chrome >= 120']},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });

    it('returns false when some resolved browsers are below minVersion', () => {
      expect(
        satisfies(
          {browserslist: ['chrome >= 80']},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(false);
    });

    it('returns true when constraint engine is not in resolved browsers', () => {
      expect(
        satisfies(
          {browserslist: ['chrome >= 120']},
          {
            requirements: [{engine: 'firefox', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });

    it('handles maxVersion with browserslist', () => {
      expect(
        satisfies(
          {browserslist: ['chrome 100']},
          {
            requirements: [{engine: 'chrome', maxVersion: '120'}]
          }
        )
      ).toBe(true);
    });

    it('fails maxVersion when browser version exceeds it', () => {
      expect(
        satisfies(
          {browserslist: ['chrome 130']},
          {
            requirements: [{engine: 'chrome', maxVersion: '120'}]
          }
        )
      ).toBe(false);
    });

    it('handles multiple browser families with one constrained', () => {
      expect(
        satisfies(
          {browserslist: ['chrome >= 120', 'firefox >= 110']},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });

    it('handles last N versions query', () => {
      // "last 1 chrome version" resolves to the latest chrome version
      // which should be well above 50
      expect(
        satisfies(
          {browserslist: ['last 1 chrome version']},
          {
            requirements: [{engine: 'chrome', minVersion: '50'}]
          }
        )
      ).toBe(true);
    });
  });

  describe('browserslist constraints — string format', () => {
    it('handles a single query string', () => {
      expect(
        satisfies(
          {browserslist: 'chrome >= 120'},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });

    it('handles comma-separated queries in a single string', () => {
      expect(
        satisfies(
          {browserslist: 'chrome >= 120, firefox >= 110'},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });
  });

  describe('browserslist constraints — Record format (env-keyed)', () => {
    it('picks production env by default', () => {
      expect(
        satisfies(
          {
            browserslist: {
              production: ['chrome >= 120'],
              development: ['last 1 chrome version']
            }
          },
          {requirements: [{engine: 'chrome', minVersion: '100'}]}
        )
      ).toBe(true);
    });

    it('picks the specified env when provided', () => {
      expect(
        satisfies(
          {
            browserslist: {
              production: ['chrome >= 120'],
              development: ['chrome >= 50']
            }
          },
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            env: 'development'
          }
        )
      ).toBe(false);
    });

    it('falls back to defaults key when env is missing', () => {
      expect(
        satisfies(
          {
            browserslist: {
              defaults: ['chrome >= 120'],
              development: ['chrome >= 50']
            }
          },
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            env: 'staging'
          }
        )
      ).toBe(true);
    });

    it('returns true when env and defaults are both missing (no queries)', () => {
      expect(
        satisfies(
          {
            browserslist: {
              development: ['chrome >= 50']
            }
          },
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            env: 'staging'
          }
        )
      ).toBe(true);
    });

    it('handles string values in Record format', () => {
      expect(
        satisfies(
          {
            browserslist: {
              production: 'chrome >= 120'
            }
          },
          {requirements: [{engine: 'chrome', minVersion: '100'}]}
        )
      ).toBe(true);
    });
  });

  describe('special browserslist versions', () => {
    it('fails for "op_mini all" when minVersion is set', () => {
      // "all" cannot be coerced to a semver version, so we can't guarantee
      // it meets the minimum
      expect(
        satisfies(
          {browserslist: ['op_mini all']},
          {
            requirements: [{engine: 'op_mini', minVersion: '1'}]
          }
        )
      ).toBe(false);
    });

    it('treats "safari TP" as latest (satisfies minVersion)', () => {
      // Safari Technology Preview resolves to the latest safari version
      expect(
        satisfies(
          {browserslist: ['safari TP']},
          {
            requirements: [{engine: 'safari', minVersion: '15'}]
          }
        )
      ).toBe(true);
    });

    it('treats "safari TP" as latest (fails low maxVersion)', () => {
      // TP resolves to latest safari, which is well above 15
      expect(
        satisfies(
          {browserslist: ['safari TP']},
          {
            requirements: [{engine: 'safari', maxVersion: '15'}]
          }
        )
      ).toBe(false);
    });

    it('treats "safari TP" as latest (satisfies high maxVersion)', () => {
      // TP resolves to latest safari, so a very high maxVersion should pass
      expect(
        satisfies(
          {browserslist: ['safari TP']},
          {
            requirements: [{engine: 'safari', maxVersion: '999'}]
          }
        )
      ).toBe(true);
    });

    it('handles range versions like ios_saf 17.5-17.6', () => {
      // The lowest part (17.5) should be >= minVersion
      expect(
        satisfies(
          {browserslist: ['ios_saf 17.5-17.6']},
          {
            requirements: [{engine: 'ios_saf', minVersion: '17'}]
          }
        )
      ).toBe(true);

      expect(
        satisfies(
          {browserslist: ['ios_saf 17.5-17.6']},
          {
            requirements: [{engine: 'ios_saf', minVersion: '18'}]
          }
        )
      ).toBe(false);
    });

    it('handles range versions for maxVersion check', () => {
      // The highest part (17.6) should be <= maxVersion
      expect(
        satisfies(
          {browserslist: ['ios_saf 17.5-17.6']},
          {
            requirements: [{engine: 'ios_saf', maxVersion: '18'}]
          }
        )
      ).toBe(true);

      expect(
        satisfies(
          {browserslist: ['ios_saf 17.5-17.6']},
          {
            requirements: [{engine: 'ios_saf', maxVersion: '17.4'}]
          }
        )
      ).toBe(false);
    });
  });

  describe('combined engine + browserslist', () => {
    it('returns true when both engines and browserslist satisfy the constraint', () => {
      expect(
        satisfies(
          {
            engines: {node: '>=18'},
            browserslist: ['node >= 18']
          },
          {requirements: [{engine: 'node', minVersion: '14.0.0'}]}
        )
      ).toBe(true);
    });

    it('returns false when engines pass but browserslist fails', () => {
      expect(
        satisfies(
          {
            engines: {node: '>=18'},
            browserslist: ['node >= 10']
          },
          {requirements: [{engine: 'node', minVersion: '14.0.0'}]}
        )
      ).toBe(false);
    });

    it('returns false when browserslist passes but engines fail', () => {
      expect(
        satisfies(
          {
            engines: {node: '>=10'},
            browserslist: ['node >= 18']
          },
          {requirements: [{engine: 'node', minVersion: '14.0.0'}]}
        )
      ).toBe(false);
    });
  });

  describe('multiple constraints', () => {
    it('returns true when all constraints are satisfied', () => {
      expect(
        satisfies(
          {
            engines: {node: '>=18'},
            browserslist: ['chrome >= 120']
          },
          {
            requirements: [
              {engine: 'node', minVersion: '14.0.0'},
              {engine: 'chrome', minVersion: '100'}
            ]
          }
        )
      ).toBe(true);
    });

    it('returns false when one constraint fails', () => {
      expect(
        satisfies(
          {
            engines: {node: '>=18'},
            browserslist: ['chrome >= 80']
          },
          {
            requirements: [
              {engine: 'node', minVersion: '14.0.0'},
              {engine: 'chrome', minVersion: '100'}
            ]
          }
        )
      ).toBe(false);
    });

    it('returns true when untargeted engines are in constraints', () => {
      expect(
        satisfies(
          {engines: {node: '>=18'}},
          {
            requirements: [
              {engine: 'node', minVersion: '14.0.0'},
              {engine: 'deno', minVersion: '1.0.0'},
              {engine: 'bun', minVersion: '1.0.0'}
            ]
          }
        )
      ).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles engines with empty object', () => {
      expect(
        satisfies(
          {engines: {}},
          {
            requirements: [{engine: 'node', minVersion: '14.0.0'}]
          }
        )
      ).toBe(true);
    });

    it('handles browserslist as empty array', () => {
      expect(
        satisfies(
          {browserslist: []},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });

    it('handles browserslist with "defaults" query', () => {
      // "defaults" is a valid browserslist query that expands to
      // "> 0.5%, last 2 versions, Firefox ESR, not dead"
      // This should not throw
      expect(() =>
        satisfies(
          {browserslist: ['defaults']},
          {
            requirements: [{engine: 'chrome', minVersion: '1'}]
          }
        )
      ).not.toThrow();
    });
  });

  describe('browserslist config file resolution', () => {
    let tmp_dir: string;

    beforeEach(() => {
      tmp_dir = mkdtempSync(join(tmpdir(), 'enginematch-test-'));
    });

    afterEach(() => {
      rmSync(tmp_dir, {recursive: true, force: true});
    });

    it('reads .browserslistrc from cwd', () => {
      writeFileSync(join(tmp_dir, '.browserslistrc'), 'chrome >= 120\n');

      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toBe(true);
    });

    it('reads browserslist file (without dot) from cwd', () => {
      writeFileSync(join(tmp_dir, 'browserslist'), 'chrome >= 120\n');

      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toBe(true);
    });

    it('fails when .browserslistrc targets old browsers', () => {
      writeFileSync(join(tmp_dir, '.browserslistrc'), 'chrome >= 50\n');

      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toBe(false);
    });

    it('supports comments in .browserslistrc', () => {
      writeFileSync(
        join(tmp_dir, '.browserslistrc'),
        '# Production browsers\nchrome >= 120\n# Firefox too\nfirefox >= 110\n'
      );

      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toBe(true);
    });

    it('supports section headers in .browserslistrc', () => {
      writeFileSync(
        join(tmp_dir, '.browserslistrc'),
        '[production]\nchrome >= 120\n\n[development]\nchrome >= 50\n'
      );

      // Default env is production
      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toBe(true);

      // Development env has older browsers
      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir,
            env: 'development'
          }
        )
      ).toBe(false);
    });

    it('prefers defaults section when specified env is missing', () => {
      writeFileSync(
        join(tmp_dir, '.browserslistrc'),
        'chrome >= 120\n\n[development]\nchrome >= 50\n'
      );

      // "staging" env doesn't exist, falls back to defaults
      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir,
            env: 'staging'
          }
        )
      ).toBe(true);
    });

    it('prefers package.json browserslist over config files', () => {
      // Config file targets old browsers
      writeFileSync(join(tmp_dir, '.browserslistrc'), 'chrome >= 50\n');

      // But package.json browserslist targets new browsers — should take precedence
      expect(
        satisfies(
          {browserslist: ['chrome >= 120']},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toBe(true);
    });

    it('does not search for config files when cwd is not provided', () => {
      // Even though the real cwd might have a .browserslistrc,
      // without cwd option, file resolution is skipped
      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}]
          }
        )
      ).toBe(true);
    });

    it('walks parent directories to find config', () => {
      const sub_dir = join(tmp_dir, 'packages', 'foo');
      mkdirSync(sub_dir, {recursive: true});
      writeFileSync(join(tmp_dir, '.browserslistrc'), 'chrome >= 120\n');

      expect(
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: sub_dir
          }
        )
      ).toBe(true);
    });

    it('throws when both .browserslistrc and browserslist file exist', () => {
      writeFileSync(join(tmp_dir, '.browserslistrc'), 'chrome >= 120\n');
      writeFileSync(join(tmp_dir, 'browserslist'), 'chrome >= 50\n');

      expect(() =>
        satisfies(
          {},
          {
            requirements: [{engine: 'chrome', minVersion: '100'}],
            cwd: tmp_dir
          }
        )
      ).toThrow();
    });
  });
});

describe('resolve', () => {
  it('resolves browserslist queries from pkg.browserslist', () => {
    expect(
      resolve({browserslist: ['chrome >= 120', 'firefox >= 110']}, {})
    ).toEqual(
      new Map([
        ['chrome', '120.0.0'],
        ['firefox', '110.0.0']
      ])
    );
  });

  it('resolves browserslist queries from config file when pkg.browserslist is undefined', () => {
    const tmp_dir = mkdtempSync(join(tmpdir(), 'enginematch-test-'));
    writeFileSync(
      join(tmp_dir, '.browserslistrc'),
      'chrome >= 120\nfirefox >= 110\n'
    );

    expect(resolve({}, {cwd: tmp_dir})).toEqual(
      new Map([
        ['chrome', '120.0.0'],
        ['firefox', '110.0.0']
      ])
    );
  });
});

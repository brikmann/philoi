/**
 * Loads src/lib/economy/catalog.ts as data, for scripts that need the REAL catalog rather than a
 * regex over its text (ids can be constants, entries span lines). catalog.ts has one import and it
 * is type-only, so a plain TypeScript transpile to CommonJS evaluates cleanly with no bundler.
 */

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const CATALOG_TS = path.join(__dirname, '..', '..', 'src', 'lib', 'economy', 'catalog.ts');

function loadCatalog() {
  const source = fs.readFileSync(CATALOG_TS, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, (id) => {
    throw new Error(`catalog.ts gained a runtime import (${id}) — load-catalog.js needs to handle it`);
  });
  return mod.exports;
}

module.exports = { loadCatalog, CATALOG_TS };

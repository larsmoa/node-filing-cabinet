'use strict';

const fs = require('fs');
const path = require('path');
const { debuglog } = require('util');

const debug = debuglog('cabinet');
const packageImportsCache = new Map();
const EXTENSIONS = ['.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '.json'];

function findPackageJson(filename) {
  let dir = path.dirname(filename);
  const { root } = path.parse(filename);
  while (dir !== root) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) return pkgPath;
    dir = path.dirname(dir);
  }

  return null;
}

function readPackageImports(pkgPath) {
  if (packageImportsCache.has(pkgPath)) return packageImportsCache.get(pkgPath);
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    packageImportsCache.set(pkgPath, pkg.imports || null);
    return pkg.imports || null;
  } catch {
    // If package.json is unreadable or invalid, treat as no imports field
    packageImportsCache.set(pkgPath, null);
    return null;
  }
}

function resolveConditional(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.import || value.require || value.node || value.default;
  }

  return null;
}

function tryResolve(filePath) {
  if (fs.existsSync(filePath)) return filePath;
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(filePath + ext)) return filePath + ext;
    if (fs.existsSync(path.join(filePath, `index${ext}`))) return path.join(filePath, `index${ext}`);
  }

  // Strip extension and retry if pattern had one
  if (path.extname(filePath)) {
    const base = filePath.replace(/\.[^/.]+$/, '');
    for (const ext of EXTENSIONS) {
      if (fs.existsSync(base + ext)) return base + ext;
    }
  }

  return null;
}

function resolveHashImport(dependency, filename) {
  if (!dependency?.startsWith('#')) return '';

  debug(`resolving hash import: ${dependency} from ${filename}`);

  const pkgPath = findPackageJson(filename);
  if (!pkgPath) return '';

  const imports = readPackageImports(pkgPath);
  if (!imports) return '';

  const pkgDir = path.dirname(pkgPath);

  // Exact match
  const exactTarget = resolveConditional(imports[dependency]);
  if (exactTarget) {
    const result = tryResolve(path.resolve(pkgDir, exactTarget));
    if (result) return result;
  }

  // Wildcard patterns
  for (const [pattern, value] of Object.entries(imports)) {
    if (!pattern.includes('*')) continue;
    const [prefix, suffix] = pattern.split('*');
    if (!dependency.startsWith(prefix)) continue;
    if (suffix && !dependency.endsWith(suffix)) continue;

    const captured = suffix ? dependency.slice(prefix.length, -suffix.length || undefined) : dependency.slice(prefix.length);
    const target = resolveConditional(value);
    if (!target) continue;

    const result = tryResolve(path.resolve(pkgDir, target.replace('*', captured)));
    if (result) return result;
  }

  return '';
}

module.exports = resolveHashImport;

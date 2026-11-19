import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reads a data file that the build copies next to the compiled catalogue
 * (scripts/copy-catalogue-data.mjs). Read with fs rather than imported, so it
 * works on every supported Node version without import attributes.
 */
export function readCatalogueJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')) as T;
}

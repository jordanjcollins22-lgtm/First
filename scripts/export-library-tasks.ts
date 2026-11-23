/**
 * Writes the resource library task list (library-gaps.ts) as CSV.
 *   npx tsx scripts/export-library-tasks.ts <out.csv>
 */
import { writeFileSync } from "node:fs";

import { gapsCsv } from "../src/lib/library-gaps";
import { DEFAULT_LIBRARY, parseLibrary } from "../src/lib/resource-library";

const out = process.argv[2] ?? "library-tasks.csv";
writeFileSync(out, gapsCsv(parseLibrary(DEFAULT_LIBRARY)));
console.log(`Wrote ${out}`);

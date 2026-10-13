import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server component can render a client component, but it can't call a
 * plain function exported from a "use client" file: at runtime that function
 * is only a reference, and calling it crashes the whole page ("Attempted to
 * call money() from the server"). Type-checking can't see this, so it is
 * checked here: no file without "use client" may import a lower-case export
 * (a function, not a component) from a file with it.
 */
const SRC = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const isClient = (source: string) => /^\s*["']use client["']/.test(source);

describe("server and client code", () => {
  it("never calls a function from a client file on the server", () => {
    const all = files(SRC);
    const clientExports = new Map<string, string[]>();
    for (const file of all) {
      const source = readFileSync(file, "utf8");
      if (!isClient(source)) continue;
      const names = [...source.matchAll(/export (?:async )?(?:function|const) ([a-z][A-Za-z0-9_]*)/g)].map((m) => m[1]);
      if (names.length) clientExports.set(file.replace(/\.(ts|tsx)$/, ""), names);
    }

    const problems: string[] = [];
    for (const file of all) {
      const source = readFileSync(file, "utf8");
      if (isClient(source)) continue;
      for (const m of source.matchAll(/import \{([^}]*)\} from ["']([^"']+)["']/g)) {
        const spec = m[2];
        const target = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? normalize(join(dirname(file), spec)) : null;
        const exported = target ? clientExports.get(target) : undefined;
        if (!exported) continue;
        for (const raw of m[1].split(",")) {
          const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
          if (name && !raw.trim().startsWith("type ") && exported.includes(name)) {
            problems.push(`${relative(SRC, file)} imports ${name} from ${spec}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

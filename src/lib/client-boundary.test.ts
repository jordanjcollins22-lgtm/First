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

  // A server component can't hand a client component a function either: the
  // page renders, then fails as the props are sent ("Functions cannot be
  // passed directly to Client Components"). Server actions are fine; an
  // arrow function in the props of a component from a "use client" file is not.
  it("never passes a plain function to a client component", () => {
    const all = files(SRC);
    const clientFiles = new Set(all.filter((f) => isClient(readFileSync(f, "utf8"))).map((f) => f.replace(/\.(ts|tsx)$/, "")));
    const problems: string[] = [];
    for (const file of all) {
      if (!file.endsWith(".tsx")) continue;
      const source = readFileSync(file, "utf8");
      if (isClient(source)) continue;
      const clientComponents = new Set<string>();
      for (const m of source.matchAll(/import \{([^}]*)\} from ["']([^"']+)["']/g)) {
        const spec = m[2];
        const target = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? normalize(join(dirname(file), spec)) : null;
        if (!target || !clientFiles.has(target)) continue;
        for (const raw of m[1].split(",")) {
          const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
          if (name && /^[A-Z]/.test(name)) clientComponents.add(name);
        }
      }
      for (const name of clientComponents) {
        for (const m of source.matchAll(new RegExp(`<${name}[\\s>/]`, "g"))) {
          // The opening tag: up to the first ">" outside braces.
          let depth = 0;
          let end = m.index! + name.length + 1;
          for (; end < source.length; end++) {
            const c = source[end];
            if (c === "{") depth++;
            else if (c === "}") depth--;
            else if (c === ">" && depth === 0 && source[end - 1] !== "=") break;
          }
          const tag = source.slice(m.index!, end)
            // Functions run here on the server to build data are fine.
            .replace(/\.(map|filter|flatMap|find|some|every|reduce|sort|forEach)\(\s*(\([^)]*\)(\s*:\s*[\w.<>[\]]+)?|\w+)\s*=>/g, "");
          for (const arrow of tag.matchAll(/=>/g)) {
            // An arrow inside a server component nested in the props (a tab's
            // content, say) runs on the server; only the client one's own count.
            const owner = [...tag.slice(0, arrow.index).matchAll(/<([A-Z][\w.]*)/g)].pop()?.[1];
            if (owner === name || (owner && clientComponents.has(owner))) {
              problems.push(`${relative(SRC, file)} passes a function to <${owner}>`);
              break;
            }
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

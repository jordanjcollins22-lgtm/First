import { describe, expect, it } from "vitest";

import {
  applyTheme,
  isThemeChoice,
  nextChoice,
  readChoice,
  themeScript,
  THEME_CHOICES,
  THEME_KEY,
  toggleLabel,
} from "./theme";

describe("readChoice", () => {
  it("takes a real choice as it finds it", () => {
    expect(readChoice("dark")).toBe("dark");
    expect(readChoice("light")).toBe("light");
    expect(readChoice("system")).toBe("system");
  });

  it("falls back to system for anything it cannot read", () => {
    // A half-written or hand-edited value should follow the phone, not
    // pick a side.
    expect(readChoice(null)).toBe("system");
    expect(readChoice(undefined)).toBe("system");
    expect(readChoice("")).toBe("system");
    expect(readChoice("DARK")).toBe("system");
    expect(readChoice("nonsense")).toBe("system");
  });
});

describe("applyTheme", () => {
  it("does what it is told when it is told", () => {
    expect(applyTheme("dark", false)).toBe("dark");
    expect(applyTheme("light", true)).toBe("light");
  });

  it("follows the phone on system", () => {
    // Somebody whose phone goes dark at sunset expects the app to follow.
    expect(applyTheme("system", true)).toBe("dark");
    expect(applyTheme("system", false)).toBe("light");
  });
});

describe("nextChoice", () => {
  it("flips what is on screen", () => {
    expect(nextChoice("light", false)).toBe("dark");
    expect(nextChoice("dark", false)).toBe("light");
  });

  it("always changes something from system", () => {
    // Tapping a switch and seeing nothing happen is how somebody decides it
    // is broken.
    expect(nextChoice("system", true)).toBe("light");
    expect(nextChoice("system", false)).toBe("dark");
  });

  it("never leaves the theme where it was", () => {
    for (const choice of ["light", "dark", "system"] as const) {
      for (const prefersDark of [true, false]) {
        const before = applyTheme(choice, prefersDark);
        const after = applyTheme(nextChoice(choice, prefersDark), prefersDark);
        expect(after, `${choice}/${prefersDark}`).not.toBe(before);
      }
    }
  });
});

describe("toggleLabel", () => {
  it("says what the tap will do, not what is on screen", () => {
    expect(toggleLabel("light", false)).toBe("Switch to dark mode");
    expect(toggleLabel("dark", false)).toBe("Switch to light mode");
    expect(toggleLabel("system", true)).toBe("Switch to light mode");
  });
});

describe("themeScript", () => {
  const script = themeScript();

  it("reads the same key the app writes", () => {
    expect(script).toContain(JSON.stringify(THEME_KEY));
  });

  it("survives a browser that refuses storage", () => {
    // Storage throws outright in a locked-down browser, and a theme
    // preference is never worth a blank page.
    expect(script).toContain("try{");
    expect(script).toContain("catch");
  });

  it("sets the colour scheme as well as the class", () => {
    // So scrollbars and form controls go dark with everything else.
    expect(script).toContain("colorScheme");
    expect(script).toContain("classList.toggle");
  });

  it("closes over itself so it cannot leak names onto the page", () => {
    expect(script.startsWith("(function()")).toBe(true);
    expect(script.trim().endsWith("})();")).toBe(true);
  });

  it("treats a missing choice as following the phone", () => {
    expect(script).toContain('c==="dark"');
    expect(script).toContain("prefers-color-scheme: dark");
  });
});

describe("the choices offered", () => {
  it("offers all three, system last", () => {
    expect(THEME_CHOICES.map((c) => c.value)).toEqual(["light", "dark", "system"]);
  });

  it("names every one", () => {
    for (const choice of THEME_CHOICES) {
      expect(isThemeChoice(choice.value)).toBe(true);
      expect(choice.label.length).toBeGreaterThan(0);
    }
  });
});

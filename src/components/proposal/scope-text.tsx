import { parseScope } from "@/lib/scope-format";

/**
 * A zone's scope of work, laid out.
 *
 * It was rendered as one paragraph, so a scope with two headings and eleven
 * bullets in it arrived as a six-hundred-word block of grey text with the
 * bullet characters sitting mid-sentence. Nothing was wrong with the wording.
 * A client could not find where one thing ended and the next began, which is
 * the only thing the layout is for.
 *
 * The stored scope is still plain text, so nothing had to change about how it
 * is written, saved or trimmed. This reads the shape back out of it.
 */
export function ScopeText({ text }: { text: string }) {
  const sections = parseScope(text);
  if (sections.length === 0) return null;

  // A single sentence with nothing above it was written as prose and reads as
  // prose. Bulleting it would be a list of one.
  const prose = sections.length === 1 && !sections[0].heading && sections[0].items.length === 1;
  if (prose) return <p className="text-sm text-muted-foreground">{sections[0].items[0]}</p>;

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section, i) => (
        <div key={i} className="flex flex-col gap-1">
          {section.heading && (
            <p className="text-sm font-semibold text-foreground">{section.heading}</p>
          )}
          <ul className="flex flex-col gap-1">
            {section.items.map((item, j) => (
              <li key={j} className="flex gap-2 text-sm text-muted-foreground">
                <span aria-hidden className="select-none text-primary">
                  •
                </span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

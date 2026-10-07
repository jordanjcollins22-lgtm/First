/**
 * What to do in an area, one line each, in the order it gets done. The
 * evaluator's answers turned into instructions (see crew-instructions), so
 * the crew read "Take out all the old mulch", not "Condition: Needs Removal".
 */
export function AreaTodo({ todo, className }: { todo: string[]; className?: string }) {
  if (todo.length === 0) return null;
  return (
    <div className={className}>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">What to do</p>
      <ol className="flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-2.5 text-sm">
        {todo.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="w-4 shrink-0 text-right font-semibold text-muted-foreground">{i + 1}.</span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

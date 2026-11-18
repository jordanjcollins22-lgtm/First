import Link from "next/link";

import "./phone.css";

/**
 * The pieces every role's home is drawn from, one to one with the Project
 * Hub's phone mock-ups (card, row, drop, stage, button). The look lives in
 * phone.css, copied from the Hub and scoped to .vx-app.
 */

export const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

export function Screen({ hello, role, children }: { hello: string; role: string; children: React.ReactNode }) {
  return (
    <div className="vx-app">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap"
        precedence="default"
      />
      <div className="vx-screen">
        <div className="vx-hello">
          <b>{hello}</b>
          <span>{role}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Card({ title, right, children, tour }: { title: string; right?: string; children?: React.ReactNode; tour?: string }) {
  return (
    <div className="vx-card" data-tour={tour}>
      {right ? (
        <div className="vx-one-h">
          <span className="vx-ct">{title}</span>
          <span className="vx-one-n">{right}</span>
        </div>
      ) : (
        <div className="vx-ct">{title}</div>
      )}
      {children}
    </div>
  );
}

const TAG = { ok: "Done", wait: "Waiting", new: "New" } as const;

/** One line: what on the left, the number or status on the right. A link when it goes somewhere. */
export function Row({ a, b, tag, href }: { a: React.ReactNode; b?: React.ReactNode; tag?: keyof typeof TAG; href?: string }) {
  const inner = (
    <>
      <span>{a}</span>
      <b>{b}</b>
      {tag ? <em className={tag}>{TAG[tag]}</em> : null}
    </>
  );
  return href ? (
    <Link href={href} className="vx-row vx-tap">
      {inner}
    </Link>
  ) : (
    <div className="vx-row">{inner}</div>
  );
}

/** A whole card that stays closed until tapped (Wallet). */
export function Drop({ title, sum, children, tour }: { title: string; sum?: React.ReactNode; children: React.ReactNode; tour?: string }) {
  return (
    <details className="vx-card vx-drop" data-tour={tour}>
      <summary>
        <span>{title}</span>
        <b>{sum}</b>
      </summary>
      {children}
    </details>
  );
}

/** A drop-down inside a card (a crew, a list). Every one starts closed. */
export function Sub({ title, sum, children, style, open }: { title: React.ReactNode; sum?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; open?: boolean }) {
  return (
    <details className="vx-crew" style={style} open={open}>
      <summary>
        <span>{title}</span>
        <b>{sum}</b>
      </summary>
      {children}
    </details>
  );
}

export function Btn({ children, href, alt }: { children: React.ReactNode; href: string; alt?: boolean }) {
  return (
    <Link href={href} className={alt ? "vx-cta vx-alt" : "vx-cta"}>
      {children}
    </Link>
  );
}

export function Sm({ children }: { children: React.ReactNode }) {
  return <div className="vx-sm">{children}</div>;
}

export function Big({ children }: { children: React.ReactNode }) {
  return <div className="vx-big">{children}</div>;
}

/**
 * Stages of Success: seven dots, where they are, and what the next one asks.
 * `done` is how many stages are finished, so the one they are on is done + 1.
 */
export function Stage({ done, total = 7, next, note }: { done: number; total?: number; next: string | null; note?: string }) {
  const on = done + 1;
  return (
    <Card title="Stages of Success" tour="affiliate-stage">
      <div className="vx-dots" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={i + 1 < on ? "d" : i + 1 === on ? "c" : ""} />
        ))}
      </div>
      <Sm>
        Stage {Math.min(on, total)} of {total}
      </Sm>
      <Sm>{next ? `Next: ${next}` : "Track done."}</Sm>
      {note ? <Sm>{note}</Sm> : null}
    </Card>
  );
}

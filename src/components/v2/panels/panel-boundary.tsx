"use client";

import { Component, type ReactNode } from "react";

/**
 * One working screen failing must never take the whole page down with it.
 * Catches anything a panel throws while it renders in the browser and shows
 * a short card in its place; the server side is caught in SafePanel.
 */
export class PanelBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <PanelFailed name={this.props.name} />;
    return this.props.children;
  }
}

export function PanelFailed({ name }: { name: string }) {
  return (
    <div role="alert" className="rounded-2xl border border-orange-300 bg-orange-50 p-4 text-sm text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
      This section ({name}) couldn&apos;t load just now. The rest of the page is fine; refresh to try it again.
    </div>
  );
}

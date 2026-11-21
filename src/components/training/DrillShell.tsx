/**
 * DrillShell.tsx wraps each cognitive drill with shared intro, progress, and done chrome.
 * Keeping the chrome identical reduces per-drill UI drift so suite mode feels like one product
 * while individual drills only own their interactive stage content.
 */

import type { ReactNode } from "react";

type DrillShellProps = {
  /** Catalog title shown above the stage. */
  title: string;
  /** Short instruction line for the current rules. */
  instruction: string;
  /** Optional progress label such as “第 4 / 20 题”. */
  progress?: string;
  /** Optional timer / score readout rendered beside progress. */
  meta?: string;
  /** Interactive stage content owned by the specific drill. */
  children: ReactNode;
  /** Footer actions (start / next / finish) owned by the drill. */
  actions?: ReactNode;
};

/**
 * DrillShell renders title, instruction, optional progress, stage children, and actions.
 * Use it for every non-Schulte drill so spacing and typography stay aligned with the hub.
 */
export function DrillShell({
  title,
  instruction,
  progress,
  meta,
  children,
  actions,
}: DrillShellProps) {
  return (
    <div className="drill">
      <header className="drill__header">
        <div>
          <h2 className="drill__title">{title}</h2>
          <p className="drill__instruction">{instruction}</p>
        </div>
        {(progress || meta) && (
          <div className="drill__meta">
            {progress ? <span>{progress}</span> : null}
            {meta ? <strong className="drill__meta-strong">{meta}</strong> : null}
          </div>
        )}
      </header>
      <div className="drill__stage">{children}</div>
      {actions ? <div className="drill__actions">{actions}</div> : null}
    </div>
  );
}

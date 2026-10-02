import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** The console's card: a titled section with an optional action area on the right. */
export const Panel = ({ title, description, actions, children, className = "" }: PanelProps) => (
  <section aria-label={title} className={`min-w-0 rounded-box border border-base-300 bg-base-100 ${className}`}>
    <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-base-300 px-4 py-3">
      <div className="min-w-0">
        <h2 className="m-0 text-sm font-semibold leading-snug">{title}</h2>
        {description && <p className="m-0 mt-0.5 text-xs leading-snug text-base-content/70">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
    <div className="p-4">{children}</div>
  </section>
);

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
  <section aria-label={title} className={`surface-card min-w-0 ${className}`}>
    <header className="surface-rule flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-5 py-4">
      <div className="min-w-0">
        <h2 className="m-0 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-white">{title}</h2>
        {description && <p className="m-0 mt-1 text-[13px] leading-snug text-[#a6a6a6]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
    <div className="p-5">{children}</div>
  </section>
);

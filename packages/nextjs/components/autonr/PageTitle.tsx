import type { ReactNode } from "react";

type PageTitleProps = {
  /** Plain text; its last word is set in the serif accent, the one place the dashboard uses it. */
  title: string;
  eyebrow?: ReactNode;
  children?: ReactNode;
  /** Heading level: the proof page keeps its h1 for the verdict. */
  as?: "h1" | "h2";
};

export const PageTitle = ({ title, eyebrow, children, as: Heading = "h1" }: PageTitleProps) => {
  const words = title.trim().split(/\s+/);
  const last = words.pop();
  return (
    <header className="min-w-0">
      {eyebrow && <div className="mb-4">{eyebrow}</div>}
      <Heading className="page-title">
        {words.length > 0 && `${words.join(" ")} `}
        <em className="serif-accent">{last}</em>
      </Heading>
      {children && <div className="page-sub">{children}</div>}
    </header>
  );
};

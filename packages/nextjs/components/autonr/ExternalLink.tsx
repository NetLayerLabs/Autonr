import type { ReactNode } from "react";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/20/solid";

export const ExternalLink = ({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className={`link link-hover inline-flex items-center gap-1 ${className}`}
  >
    {children}
    <ArrowTopRightOnSquareIcon className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
    <span className="sr-only">(opens in a new tab)</span>
  </a>
);

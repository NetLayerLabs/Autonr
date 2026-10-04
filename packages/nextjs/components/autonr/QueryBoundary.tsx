import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";

type QueryBoundaryProps<T> = {
  query: UseQueryResult<T, Error>;
  children: (data: T) => ReactNode;
  skeletonLines?: number;
};

/**
 * Loading, error and data states of a dashboard query. When a background refresh fails, the last good data stays on
 * screen under a warning instead of being replaced by the error.
 */
export function QueryBoundary<T>({ query, children, skeletonLines = 3 }: QueryBoundaryProps<T>) {
  const retry = () => void query.refetch();
  if (query.data === undefined) {
    return query.isError ? (
      <ErrorNotice message={query.error.message} onRetry={retry} />
    ) : (
      <Skeleton lines={skeletonLines} />
    );
  }
  return (
    <>
      {query.isError && (
        <div className="mb-3">
          <ErrorNotice message={`Showing the last good data. ${query.error.message}`} onRetry={retry} />
        </div>
      )}
      {children(query.data)}
    </>
  );
}

export const ErrorNotice = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div role="alert" className="tone-rose flex items-start gap-2 rounded-xl p-3 text-sm">
    <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <p className="m-0 min-w-0 grow break-words">{message}</p>
    {onRetry && (
      <button type="button" className="btn btn-xs text-white" onClick={onRetry}>
        Retry
      </button>
    )}
  </div>
);

const SKELETON_WIDTHS = ["w-11/12", "w-9/12", "w-10/12", "w-7/12", "w-8/12"];

const Skeleton = ({ lines }: { lines: number }) => (
  <div className="flex flex-col gap-2" aria-busy="true">
    {Array.from({ length: lines }, (_, index) => (
      <div key={index} className={`skeleton h-4 ${SKELETON_WIDTHS[index % SKELETON_WIDTHS.length]}`} />
    ))}
    <span className="sr-only">Loading</span>
  </div>
);

import { Skeleton } from '@/components/ui/skeleton'

export function AuthPageSkeleton() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4" aria-busy="true">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-card p-6">
        <div className="space-y-2">
          <Skeleton className="mx-auto h-8 w-40" />
          <Skeleton className="mx-auto h-4 w-56" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
    </main>
  )
}

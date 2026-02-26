import Link from "next/link";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground">System management and sync controls</p>
      </div>
      <nav className="flex gap-2 mb-6 border-b border-border/50 pb-4">
        <Link
          href="/admin"
          className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          📊 UCI Sync
        </Link>
        <Link
          href="/admin/crons"
          className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors"
        >
          ⏰ Cron Dashboard
        </Link>
      </nav>
      {children}
    </div>
  );
}

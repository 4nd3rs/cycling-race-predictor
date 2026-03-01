import Link from "next/link";

const navItems = [
  { href: "/admin", label: "Overview", emoji: "📊" },
  { href: "/admin/pipeline", label: "Pipeline", emoji: "🔧" },
  { href: "/admin/predictions", label: "Predictions", emoji: "🔮" },
  { href: "/admin/data-quality", label: "Data Quality", emoji: "🔍" },
  { href: "/admin/users", label: "Users", emoji: "👥" },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground text-sm">Ops centre for Pro Cycling Predictor</p>
      </div>
      <nav className="flex gap-1 mb-6 border-b border-border/50 pb-4 overflow-x-auto">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted/50 transition-colors whitespace-nowrap"
          >
            {item.emoji} {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}

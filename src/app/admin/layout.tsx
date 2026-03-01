"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", label: "Overview", emoji: "📊" },
  { href: "/admin/pipeline", label: "Pipeline", emoji: "🔧" },
  { href: "/admin/predictions", label: "Predictions", emoji: "🔮" },
  { href: "/admin/data-quality", label: "Data Quality", emoji: "🔍" },
  { href: "/admin/users", label: "Users", emoji: "👥" },
];

function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 mb-6 border-b border-border/50 pb-4 overflow-x-auto">
      {navItems.map((item) => {
        const isActive = item.href === "/admin"
          ? pathname === "/admin"
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              isActive
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.emoji} {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

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
      <AdminNav />
      {children}
    </div>
  );
}

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
      {children}
    </div>
  );
}

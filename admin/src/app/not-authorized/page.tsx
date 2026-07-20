export default function NotAuthorizedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-slate-900">Not authorized</h1>
        <p className="mt-2 text-sm text-slate-500">
          This account doesn&apos;t have admin access. Ask an existing admin to set
          <code className="mx-1 rounded bg-slate-100 px-1 py-0.5">profiles.is_admin</code>
          for your account.
        </p>
      </div>
    </main>
  );
}

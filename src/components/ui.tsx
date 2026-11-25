import { Brand } from "./Brand";

export function AuthShell({ title, children, subtitle }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-10">
      <Brand />
      <div className="card mt-6">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <div className="muted mt-1 text-sm">{subtitle}</div> : null}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: React.ReactNode }) {
  const cls = kind === "error" ? "bg-red-50 text-red-800 ring-red-200" : kind === "success" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-surface-muted text-ink ring-ink/10";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`mb-4 rounded-s px-3 py-2 text-sm ring-1 ${cls}`}>
      {children}
    </div>
  );
}

export function Field({ label, name, type = "text", required, defaultValue, autoComplete, hint, placeholder }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string | null; autoComplete?: string; hint?: string; placeholder?: string;
}) {
  return (
    <div className="mb-4">
      <label className="label" htmlFor={name}>{label}</label>
      <input className="input" id={name} name={name} type={type} required={required} defaultValue={defaultValue ?? undefined} autoComplete={autoComplete} placeholder={placeholder} />
      {hint ? <p className="muted mt-1 text-xs">{hint}</p> : null}
    </div>
  );
}

export function Messages({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const err = typeof sp.error === "string" ? sp.error : null;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  return (
    <>
      {err ? <Notice kind="error">{err}</Notice> : null}
      {ok ? <Notice kind="success">{ok}</Notice> : null}
    </>
  );
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export function str(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

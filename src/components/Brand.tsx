import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold text-ink">
      <img src="/mark.svg" alt="" width={28} height={28} />
      <span>Sentire Cloud</span>
    </Link>
  );
}

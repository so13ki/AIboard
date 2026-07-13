import Link from "next/link";

const links = [
  { href: "/", label: "ダッシュボード" },
  { href: "/company", label: "会社設定" },
  { href: "/board-members", label: "役員" },
  { href: "/projects", label: "企画" },
  { href: "/meetings", label: "会議履歴" },
];

export function AppNav() {
  return (
    <header className="border-b border-stone-300 bg-stone-100">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-stone-900">
          AI役員会
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm text-stone-700">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hover:text-stone-950 hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

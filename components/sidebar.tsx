"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  CalendarRange,
  FolderKanban,
  Users,
  Tag,
  Share2,
  Settings,
  LogOut,
} from "lucide-react"
import { signOut } from "next-auth/react"

const nav = [
  { label: "Overview", href: "/", icon: LayoutDashboard },
  { label: "Timeline", href: "/timeline", icon: CalendarRange },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Work Types", href: "/work-types", icon: Tag },
  { label: "Shared Views", href: "/shared-views", icon: Share2 },
  { label: "Settings", href: "/settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border bg-surface">
      <div className="px-5 py-6 border-b border-border">
        <div className="serif text-xl text-foreground">Rafic Fekih</div>
        <div className="mono text-[10px] uppercase tracking-[0.2em] text-muted mt-1">Production Planner</div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map((item) => {
          const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-surface-2 text-gold border border-border"
                  : "text-muted hover:text-foreground hover:bg-surface-2"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="px-3 py-4 border-t border-border">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
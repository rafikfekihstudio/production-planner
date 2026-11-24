import { auth } from "@/lib/auth"
import { loadBusinessName } from "@/lib/business-name-store"
import { redirect } from "next/navigation"
import { Sidebar } from "@/components/sidebar"
import { AssistantPanel } from "@/components/assistant/assistant-panel"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [session, businessName] = await Promise.all([auth(), loadBusinessName()])
  if (!session?.user) redirect("/login")

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar businessName={businessName} />
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
      <AssistantPanel />
    </div>
  )
}

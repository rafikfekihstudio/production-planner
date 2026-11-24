import { DEFAULT_BUSINESS_NAME } from "@/lib/brand"
import { loadBusinessName } from "@/lib/business-name-store"
import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const businessName = await loadBusinessName()

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="serif text-3xl text-foreground">{businessName}</div>
          {businessName !== DEFAULT_BUSINESS_NAME && (
            <div className="mono text-[10px] uppercase tracking-[0.25em] text-muted mt-2">Production Planner</div>
          )}
        </div>
        <LoginForm />
      </div>
    </div>
  )
}

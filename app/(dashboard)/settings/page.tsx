import { SettingsForm } from "@/components/settings/settings-form"
import { auth } from "@/lib/auth"
import { loadBusinessName } from "@/lib/business-name-store"
import { getAssistantKeyStatus, type AssistantKeyStatus } from "@/lib/assistant/api-key"
import { loadAssistantPrefs } from "@/lib/assistant/preferences-store"
import { upcomingBlocks } from "@/lib/assistant/simulate"
import { loadCalendarState } from "@/lib/assistant/state"
import { todayInTimezone } from "@/lib/assistant/time"
import { loadScheduleRules } from "@/lib/schedule-store"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [rules, prefs, state, session, businessName] = await Promise.all([
    loadScheduleRules(),
    loadAssistantPrefs(),
    loadCalendarState(),
    auth(),
    loadBusinessName(),
  ])

  const keyStatus: AssistantKeyStatus = session?.user?.id
    ? await getAssistantKeyStatus(session.user.id)
    : {
        personalKeySaved: false,
        sharedKeyAvailable: Boolean(process.env.GEMINI_API_KEY),
        encryptionConfigured: Boolean(process.env.GEMINI_KEY_ENCRYPTION_SECRET),
        activeSource: process.env.GEMINI_API_KEY ? "environment" : null,
      }

  const today = todayInTimezone()

  return (
    <SettingsForm
      initialRules={rules}
      initialPrefs={prefs}
      initialBusinessName={businessName}
      initialKeyStatus={keyStatus}
      upcoming={upcomingBlocks(state, today)}
      today={today}
    />
  )
}

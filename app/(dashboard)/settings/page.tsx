import { SettingsForm } from "@/components/settings/settings-form"
import { loadBusinessName } from "@/lib/business-name-store"
import { loadAssistantPrefs } from "@/lib/assistant/preferences-store"
import { upcomingBlocks } from "@/lib/assistant/simulate"
import { loadCalendarState } from "@/lib/assistant/state"
import { todayInTimezone } from "@/lib/assistant/time"
import { loadScheduleRules } from "@/lib/schedule-store"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [rules, prefs, state, businessName] = await Promise.all([
    loadScheduleRules(),
    loadAssistantPrefs(),
    loadCalendarState(),
    loadBusinessName(),
  ])

  const today = todayInTimezone()

  return (
    <SettingsForm
      initialRules={rules}
      initialPrefs={prefs}
      initialBusinessName={businessName}
      upcoming={upcomingBlocks(state, today)}
      today={today}
    />
  )
}

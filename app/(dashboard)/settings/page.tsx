import { SettingsForm } from "@/components/settings/settings-form"
import { loadAssistantPrefs } from "@/lib/assistant/preferences-store"
import { upcomingBlocks } from "@/lib/assistant/simulate"
import { loadCalendarState } from "@/lib/assistant/state"
import { todayInTimezone } from "@/lib/assistant/time"
import { loadScheduleRules } from "@/lib/schedule-store"

export const dynamic = "force-dynamic"

export default async function Page() {
  const [rules, prefs, state] = await Promise.all([
    loadScheduleRules(),
    loadAssistantPrefs(),
    loadCalendarState(),
  ])

  const today = todayInTimezone()

  return (
    <SettingsForm
      initialRules={rules}
      initialPrefs={prefs}
      upcoming={upcomingBlocks(state, today)}
      today={today}
    />
  )
}

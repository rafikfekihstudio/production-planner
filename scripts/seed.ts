import bcrypt from "bcryptjs"
import { db } from "../lib/db"
import { users, workTypes, settings } from "../lib/db/schema"
import { eq } from "drizzle-orm"

const WORK_TYPES = [
  { name: "Beverage Retouching", defaultDuration: 90, color: "#c9a961" },
  { name: "Liquid Compositing", defaultDuration: 120, color: "#4a9b8e" },
  { name: "Label Retouching", defaultDuration: 45, color: "#8a9bb0" },
  { name: "Food Retouching", defaultDuration: 75, color: "#c96161" },
  { name: "Product Retouching", defaultDuration: 60, color: "#a8894a" },
  { name: "Beauty Retouching", defaultDuration: 120, color: "#b08aa8" },
  { name: "HDR Merging", defaultDuration: 30, color: "#7a9bb0" },
  { name: "Hospitality Interiors", defaultDuration: 180, color: "#9bb07a" },
  { name: "Image Compositing", defaultDuration: 150, color: "#b0a07a" },
  { name: "General Retouching", defaultDuration: 60, color: "#8a877f" },
  { name: "Administration", defaultDuration: 30, color: "#6a6a6e" },
]

async function seed() {
  const email = (process.env.SEED_ADMIN_EMAIL || "admin@example.com").trim()
  const name = (process.env.SEED_ADMIN_NAME || "Studio Admin").trim()
  const password = process.env.SEED_ADMIN_PASSWORD

  if (!password) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required. Set it in .env.local before running the seed script.",
    )
  }
  if (password.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters.")
  }

  const existing = await db.select().from(users).where(eq(users.email, email)).get()
  if (!existing) {
    const hash = await bcrypt.hash(password, 12)
    await db.insert(users).values({ email, name, password: hash, role: "admin" }).run()
    console.log(`created ${email}`)
  } else {
    console.log(`${email} already exists`)
  }

  for (const wt of WORK_TYPES) {
    const ex = await db.select().from(workTypes).where(eq(workTypes.name, wt.name)).get()
    if (!ex) {
      await db.insert(workTypes).values(wt).run()
    }
  }
  console.log("work types seeded")

  // default settings
  const defaults: Record<string, string> = {
    businessName: JSON.stringify("Rafic Fekih Studio"),
    workingDays: JSON.stringify([1, 2, 3, 4, 5]),
    dailyHours: JSON.stringify({ start: "09:00", end: "18:00" }),
    timezone: JSON.stringify("Africa/Tunis"),
    maxDailyMinutes: JSON.stringify(480),
  }
  for (const [k, v] of Object.entries(defaults)) {
    const ex = await db.select().from(settings).where(eq(settings.key, k)).get() as { key: string } | undefined
    if (!ex) await db.insert(settings).values({ key: k, value: v }).run()
  }
  console.log("settings seeded")
  process.exit(0)
}

seed().catch((e) => { console.error(e); process.exit(1) })
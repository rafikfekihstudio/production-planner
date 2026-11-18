import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core"

const nowISO = () => new Date().toISOString()

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  password: text("password").notNull(),
  role: text("role", { enum: ["admin", "retoucher"] }).notNull().default("retoucher"),
  avatarUrl: text("avatar_url"),
  createdAt: text("created_at").$defaultFn(nowISO),
})

export const workTypes = sqliteTable("work_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  defaultDuration: integer("default_duration").notNull().default(60), // minutes
  color: text("color").notNull().default("#c9a961"),
  description: text("description"),
  createdAt: text("created_at").$defaultFn(nowISO),
})

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").$defaultFn(nowISO),
  updatedAt: text("updated_at").$defaultFn(nowISO),
})

export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  area: text("area", { enum: ["work", "personal"] }).notNull().default("work"),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  description: text("description"),
  startDate: text("start_date"),
  deadline: text("deadline"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
  status: text("status", {
    enum: ["inquiry", "waiting_files", "ready", "scheduled", "in_progress", "waiting_feedback", "revision", "completed", "archived"],
  }).notNull().default("inquiry"),
  estimatedHours: real("estimated_hours").notNull().default(0),
  actualHours: real("actual_hours").notNull().default(0),
  internalNotes: text("internal_notes"),
  clientVisibleProgress: text("client_visible_progress"),
  createdAt: text("created_at").$defaultFn(nowISO),
  updatedAt: text("updated_at").$defaultFn(nowISO),
})

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "set null" }),
  workTypeId: integer("work_type_id").references(() => workTypes.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  estimatedMinutes: integer("estimated_minutes").notNull().default(60),
  actualMinutes: integer("actual_minutes").notNull().default(0),
  scheduledDate: text("scheduled_date"), // YYYY-MM-DD
  startTime: text("start_time"), // HH:MM
  endTime: text("end_time"), // HH:MM
  deadline: text("deadline"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] }).notNull().default("medium"),
  status: text("status", {
    enum: ["backlog", "scheduled", "in_progress", "paused", "completed", "cancelled"],
  }).notNull().default("backlog"),
  clientVisibleNotes: text("client_visible_notes"),
  referenceUrl: text("reference_url"),
  createdAt: text("created_at").$defaultFn(nowISO),
  updatedAt: text("updated_at").$defaultFn(nowISO),
})

export const timeEntries = sqliteTable("time_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  createdAt: text("created_at").$defaultFn(nowISO),
})

export const availability = sqliteTable(
  "availability",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    status: text("status", { enum: ["available", "busy", "tentative", "off"] }).notNull().default("available"),
    updatedAt: text("updated_at").$defaultFn(nowISO),
  },
  (t) => [uniqueIndex("availability_user_date_idx").on(t.userId, t.date)],
)

export const sharingTokens = sqliteTable("sharing_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token: text("token").notNull().unique(),
  scope: text("scope", { enum: ["project", "client", "selection"] }).notNull().default("selection"),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  clientId: integer("client_id").references(() => clients.id, { onDelete: "cascade" }),
  visibleFields: text("visible_fields"), // JSON
  expiresAt: text("expires_at"),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").$defaultFn(nowISO),
})

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").$defaultFn(nowISO),
})
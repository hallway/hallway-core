import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const organisms = sqliteTable("organisms", {
  id: text("id").primaryKey(), // org-{uuid short}
  token: text("token").notNull().unique(), // auth token
  parentId: text("parent_id"),
  generation: integer("generation").notNull().default(0),
  credits: real("credits").notNull().default(0),
  status: text("status", { enum: ["alive", "dead", "spawning"] }).notNull().default("spawning"),
  containerId: text("container_id"),
  kernelHash: text("kernel_hash"), // sha256 of improve.ts variant
  totalEarned: real("total_earned").notNull().default(0),
  totalSpent: real("total_spent").notNull().default(0),
  tasksCompleted: integer("tasks_completed").notNull().default(0),
  bestScore: integer("best_score").notNull().default(0),
  childrenSpawned: integer("children_spawned").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
  diedAt: integer("died_at", { mode: "timestamp" }),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  fixture: text("fixture").notNull(), // fixture name (e.g. "sim-tower")
  organismId: text("organism_id").references(() => organisms.id),
  status: text("status", { enum: ["available", "assigned", "submitted", "scored"] }).notNull().default("available"),
  score: integer("score"),
  breakdown: text("breakdown"), // JSON: { rendering: 85, building: 70, ... }
  workDir: text("work_dir"), // path to output
  assignedAt: integer("assigned_at", { mode: "timestamp" }),
  submittedAt: integer("submitted_at", { mode: "timestamp" }),
  scoredAt: integer("scored_at", { mode: "timestamp" }),
});

export const transactions = sqliteTable("transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  organismId: text("organism_id").notNull().references(() => organisms.id),
  type: text("type", { enum: ["seed", "earn", "spend", "transfer_in", "transfer_out", "spawn_cost", "spawn_grant"] }).notNull(),
  amount: real("amount").notNull(), // positive = credit, negative = debit
  balance: real("balance").notNull(), // balance after transaction
  detail: text("detail"),
  relatedOrganismId: text("related_organism_id"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromId: text("from_id").notNull().references(() => organisms.id),
  toId: text("to_id").references(() => organisms.id), // null = broadcast
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().$defaultFn(() => new Date()),
});

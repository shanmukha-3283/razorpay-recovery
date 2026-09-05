import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

/**
 * Runs pending Drizzle migrations using only production dependencies
 * (postgres + drizzle-orm). Invoked by the Docker entrypoint on every
 * boot so fresh Render databases self-initialize; `migrate()` is a
 * no-op when nothing is pending, making this safe on every start.
 */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set; cannot run migrations.");
  }

  const migrationsFolder = fileURLToPath(
    new URL("../../migrations", import.meta.url)
  );
  console.log(`Applying DB migrations from ${migrationsFolder}...`);

  const client = postgres(connectionString, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
    console.log("DB migrations applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("DB migration failed:", err);
  process.exit(1);
});

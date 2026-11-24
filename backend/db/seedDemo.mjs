import "dotenv/config";
import pg from "pg";
import { newDatabaseOptions } from "../src/config/newDatabase.js";

const tenantId = "synthetic-demo";
const products = [
  ["71070b36-8bdf-4aaa-b221-77622ad658cf", "Demo Almond Milk", "Beverages", 7, 20, 11],
  ["00b3c522-1c2d-4555-8d40-fdbc048c923b", "Demo Rolled Oats", "Pantry", 2200, 30, 6],
  ["261033ee-a1bc-4119-8f34-a3a5876f6903", "Demo Trail Mix", "Snacks", 300, 25, 8],
];

if (process.argv[2] !== "--seed-synthetic-demo") {
  console.error("Usage: node db/seedDemo.mjs --seed-synthetic-demo");
  process.exit(1);
}

let client;
try {
  client = new pg.Client(newDatabaseOptions());
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
  const { rowCount } = await client.query(`
    SELECT 1 FROM public.tenants t
    JOIN public.tenant_memberships m ON m.tenant_id = t.id
    WHERE t.id = $1 AND t.name = 'OpsPulse Synthetic Demo' AND m.role = 'owner' AND m.revoked_at IS NULL
  `, [tenantId]);
  if (!rowCount) throw new Error("Provision the synthetic demo tenant and explicit owner first");

  for (const [id, name, category, stock, threshold, demand] of products) {
    const inserted = await client.query(`
      INSERT INTO public.products(id, tenant_id, name, category, stock_quantity, reorder_threshold)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING RETURNING id
    `, [id, tenantId, name, category, stock, threshold]);
    if (!inserted.rowCount) {
      const existing = await client.query("SELECT 1 FROM public.products WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
      if (!existing.rowCount) throw new Error("Demo product identifier is already assigned to a different tenant");
      continue;
    }
    await client.query(`
      INSERT INTO public.inventory_movements(tenant_id, product_id, movement_type, quantity, reason)
      VALUES ($1, $2, 'INITIAL', $3, 'Synthetic demo opening stock')
    `, [tenantId, id, stock]);
    await client.query(`
      INSERT INTO public.sales(tenant_id, product_id, sale_date, quantity)
      SELECT tenant_id, id,
        ((created_at AT TIME ZONE 'UTC')::date - day_number)::timestamp AT TIME ZONE 'UTC',
        $3::integer + (day_number % 7)
      FROM public.products CROSS JOIN generate_series(1, 150) AS days(day_number)
      WHERE tenant_id = $1 AND id = $2
    `, [tenantId, id, demand]);
    await client.query(`
      INSERT INTO public.predictions(tenant_id, product_id, predicted_demand, rule_prediction,
        ml_prediction, adjusted_prediction, avg_sales, percent_change, confidence,
        season_tag, decision, impact, reason, prediction_source)
      VALUES ($1,$2,$3,$3,$3,$3,$3,0,'Medium','Demo','maintain','neutral','Synthetic fixture','rule-based')
    `, [tenantId, id, demand + 3]);
  }
  await client.query("COMMIT");
  console.log("Synthetic demo data is ready");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => {});
  console.error("Synthetic demo seeding failed:", error.code || error.name);
  process.exitCode = 1;
} finally {
  await client?.end();
}

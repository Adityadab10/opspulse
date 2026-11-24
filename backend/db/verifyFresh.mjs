import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { newDatabaseOptions } from "../src/config/newDatabase.js";
import pool, { activateFreshDatabase } from "../src/config/database.js";
import { executeInventoryAgentAction } from "../src/controllers/inventoryAgentController.js";
import { runWithRequestContext } from "../src/services/requestContext.js";

const operator = new pg.Client(newDatabaseOptions());
const mlEnv = parse(readFileSync(new URL("../../ml-service/.env", import.meta.url)));
function runtime(env) {
  return new pg.Client(newDatabaseOptions({ ...env, OPSPULSE_NEW_DATABASE_URL: env.OPSPULSE_RUNTIME_DATABASE_URL }));
}
const express = runtime(process.env);
const ml = runtime(mlEnv);
let client = express;
let fixturesCommitted = false;
let inventoryPoolActive = false;
const runId = randomUUID();
const actionId = randomUUID();
const [tenantA, tenantB, userA, userB, productA, productB, documentKey] = Array.from({ length: 7 }, randomUUID);
let stage = "connection";
const setTenant = (tenant) => client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenant]);

async function rejects(sql, params, code) {
  await client.query("SAVEPOINT rejected_query");
  try {
    await assert.rejects(client.query(sql, params), (error) => error.code === code);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT rejected_query");
  }
}

try {
  await operator.connect();
  await express.connect();
  await ml.connect();
  await operator.query("BEGIN");
  client = operator;
  stage = "test fixtures";
  await client.query("INSERT INTO tenants(id, name) VALUES ($1, 'Rollback A'), ($2, 'Rollback B')", [tenantA, tenantB]);
  await client.query("INSERT INTO app_users(id, clerk_user_id) VALUES ($1, $2), ($3, $4)", [userA, userA, userB, userB]);
  await client.query("INSERT INTO tenant_memberships(tenant_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'member')", [tenantA, userA, tenantB, userB]);
  await client.query("INSERT INTO products(id, tenant_id, name, category) VALUES ($1, $2, 'A', 'test'), ($3, $4, 'B', 'test')", [productA, tenantA, productB, tenantB]);
  await client.query(`
    INSERT INTO ai_document_chunks(tenant_id, document_key, title, content, content_hash)
    VALUES (NULL, $1, 'shared', 'test', $2), ($3, $1, 'A', 'test', $2), ($4, $1, 'B', 'test', $2)
  `, [documentKey, "a".repeat(64), tenantA, tenantB]);

  const vector = JSON.stringify([1, ...Array(383).fill(0)]);
  await client.query("UPDATE ai_document_chunks SET embedding = $1::extensions.vector WHERE document_key = $2", [vector, documentKey]);
  for (let attempt = 0; attempt < 2; attempt++) {
    await client.query(`
      INSERT INTO ai_document_chunks(tenant_id, document_key, title, content, content_hash, embedding)
      VALUES (NULL, $1, 'shared', 'synthetic', $2, $3::extensions.vector)
      ON CONFLICT (document_key, content_hash, version) WHERE tenant_id IS NULL
      DO UPDATE SET content = EXCLUDED.content
    `, [documentKey, "a".repeat(64), vector]);
    await client.query(`
      INSERT INTO ai_document_chunks(tenant_id, document_key, title, content, content_hash, embedding)
      VALUES ($1, $2, 'A', 'synthetic', $3, $4::extensions.vector)
      ON CONFLICT (tenant_id, document_key, content_hash, version) WHERE tenant_id IS NOT NULL
      DO UPDATE SET content = EXCLUDED.content
    `, [tenantA, documentKey, "a".repeat(64), vector]);
  }
  await client.query("INSERT INTO agent_runs(id, tenant_id, user_id, thread_id, question) VALUES ($1, $2, $3, $4, 'Synthetic concurrency check')", [runId, tenantA, userA, runId]);
  await client.query(`
    INSERT INTO inventory_agent_actions(id, tenant_id, run_id, product_id, recommendation, status, approved_by, approved_at)
    VALUES ($1,$2,$3,$4,$5,'approved',$6,now())
  `, [actionId, tenantA, runId, productA, JSON.stringify({
    currentStock: 0, proposedAction: { type: "record_replenishment", quantity: 6 },
  }), userA]);
  await operator.query("COMMIT");
  fixturesCommitted = true;
  stage = "Express RLS and foreign keys";
  client = express;
  await express.query("BEGIN");
  const readProducts = () => client.query("SELECT id FROM products WHERE id = ANY($1::uuid[])", [[productA, productB]]);
  assert.equal((await readProducts()).rowCount, 0);
  await setTenant(tenantA);
  assert.deepEqual((await readProducts()).rows, [{ id: productA }]);
  assert.equal((await client.query("UPDATE products SET stock_quantity=1 WHERE id=$1", [productB])).rowCount, 0);
  await rejects("INSERT INTO products(tenant_id, name, category) VALUES ($1, 'foreign', 'test')", [tenantB], "42501");
  await rejects("INSERT INTO sales(tenant_id, product_id, sale_date, quantity) VALUES ($1, $2, now(), 1)", [tenantA, productB], "23503");

  stage = "membership RLS";
  await client.query("SELECT set_config('app.current_clerk_user_id', $1, true), set_config('app.current_user_id', $1, true)", [userA]);
  const memberships = await client.query("SELECT tenant_id FROM tenant_memberships WHERE user_id = ANY($1::varchar[])", [[userA, userB]]);
  assert.deepEqual(memberships.rows, [{ tenant_id: tenantA }]);

  stage = "ML privileges and RAG";
  await express.query("ROLLBACK");
  client = ml;
  await ml.query("BEGIN");
  await setTenant(tenantA);
  const docs = await client.query(`
    SELECT title FROM ai_document_chunks WHERE document_key=$1
    ORDER BY embedding OPERATOR(extensions.<=>) $2::extensions.vector, title
  `, [documentKey, vector]);
  assert.deepEqual(docs.rows, [{ title: "A" }, { title: "shared" }]);
  await rejects("UPDATE products SET stock_quantity=2 WHERE id=$1", [productA], "42501");
  await client.query("ROLLBACK");
  console.log("Live RLS, memberships, composite foreign keys, vector retrieval and duplicate RAG upserts passed.");

  stage = "concurrent inventory execution";
  activateFreshDatabase();
  inventoryPoolActive = true;
  async function executeAs(tenantId, userId) {
    const authContext = { tenantId, userId };
    const response = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this; },
      json(value) { this.body = value; return this; },
    };
    await runWithRequestContext(authContext, () =>
      executeInventoryAgentAction({ authContext, params: { actionId } }, response));
    return response;
  }
  assert.equal((await executeAs(tenantB, userB)).statusCode, 404);
  const responses = await Promise.all([executeAs(tenantA, userA), executeAs(tenantA, userA)]);
  assert.deepEqual(responses.map(response => response.statusCode), [200, 200]);
  assert.equal(responses.filter(response => response.body.duplicate).length, 1);
  assert.equal((await operator.query("SELECT stock_quantity FROM products WHERE id=$1", [productA])).rows[0].stock_quantity, 6);
  assert.equal((await operator.query("SELECT count(*)::int AS count FROM inventory_movements WHERE product_id=$1", [productA])).rows[0].count, 1);
  assert.equal((await operator.query("SELECT status FROM inventory_agent_actions WHERE id=$1", [actionId])).rows[0].status, "executed");
  console.log("Live concurrent inventory execution recorded one movement and one stock update.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Verification failed during", stage, error.code || error.name);
  process.exitCode = 1;
} finally {
  try {
    if (fixturesCommitted) {
      await operator.query("BEGIN");
      await operator.query("DELETE FROM ai_document_chunks WHERE document_key = $1", [documentKey]);
      await operator.query("DELETE FROM inventory_agent_actions WHERE id = $1 AND tenant_id = $2", [actionId, tenantA]);
      await operator.query("DELETE FROM agent_runs WHERE id = $1 AND tenant_id = $2", [runId, tenantA]);
      await operator.query("DELETE FROM inventory_movements WHERE product_id = $1 AND tenant_id = $2", [productA, tenantA]);
      await operator.query("DELETE FROM products WHERE tenant_id = ANY($1::varchar[])", [[tenantA, tenantB]]);
      await operator.query("DELETE FROM tenant_memberships WHERE tenant_id = ANY($1::varchar[])", [[tenantA, tenantB]]);
      await operator.query("DELETE FROM tenants WHERE id = ANY($1::varchar[])", [[tenantA, tenantB]]);
      await operator.query("DELETE FROM app_users WHERE id = ANY($1::varchar[])", [[userA, userB]]);
      await operator.query("COMMIT");
      console.log("Removed only the synthetic verification fixtures.");
    }
  } catch (error) {
    await operator.query("ROLLBACK").catch(() => {});
    console.error("Synthetic fixture cleanup failed:", error.code || error.name);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([operator.end(), express.end(), ml.end(), ...(inventoryPoolActive ? [pool.end()] : [])]);
  }
}

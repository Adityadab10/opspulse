import pool from "../config/database.js";
import { adjustProductStock } from "../config/postgres.js";
import { getInventoryHealthData } from "../config/postgres.js";
import { calculateInventoryHealth } from "../services/inventoryIntelligence.js";
import { getMlAnalystConfig, requestMlService } from "../services/mlAnalystClient.js";
import { sendBackendError } from "../helpers/errorResponse.js";

const actionView = (row) => ({ ...row, recommendation: row.recommendation, executionResult: row.execution_result });

export const startInventoryAgent = async (req, res) => {
  const { tenantId, userId } = req.authContext;
  const horizonDays = Number(req.body?.horizonDays ?? 30);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 90) return res.status(400).json({ message: "horizonDays must be an integer between 1 and 90" });
  const config = getMlAnalystConfig();
  if (!config.internalToken) return res.status(503).json({ message: "Inventory Agent authorization is not configured" });
  try {
    const inventoryHealth = calculateInventoryHealth(await getInventoryHealthData(tenantId), { horizonDays });
    const response = await requestMlService({ url: config.inventoryAgentUrl, timeoutMs: config.timeoutMs, internalToken: config.internalToken, userId, tenantId, correlationId: req.correlationId, body: { horizon_days: horizonDays, inventory_health: inventoryHealth } });
    if (!response.ok) return res.status(response.status).json(response.payload);
    const result = response.payload;
    const recommendations = Array.isArray(result.recommendations) ? result.recommendations : [];
    for (const recommendation of recommendations.filter((item) => item.proposedAction?.type === "record_replenishment")) {
      await pool.query(`INSERT INTO inventory_agent_actions (tenant_id, run_id, product_id, recommendation)
        VALUES ($1, $2::uuid, $3::uuid, $4::jsonb) ON CONFLICT (tenant_id, run_id, product_id) DO NOTHING`,
      [tenantId, result.run_id, recommendation.product.id, JSON.stringify(recommendation)]);
    }
    return res.status(201).json(result);
  } catch (error) { return sendBackendError(res, "Inventory Agent unavailable", error); }
};

export const listInventoryAgentRuns = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT r.id, r.status, r.final_answer, r.limitations, r.started_at, r.completed_at,
      COALESCE(json_agg(a ORDER BY a.created_at DESC) FILTER (WHERE a.id IS NOT NULL), '[]') AS actions
      FROM agent_runs r LEFT JOIN inventory_agent_actions a ON a.run_id = r.id AND a.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.selected_agents @> '["inventory_agent"]'::jsonb
      GROUP BY r.id ORDER BY r.started_at DESC LIMIT 25`, [req.authContext.tenantId]);
    return res.json({ runs: rows.map((row) => ({ ...row, actions: row.actions.map(actionView) })) });
  } catch (error) { return sendBackendError(res, "Failed to load Inventory Agent runs", error); }
};

export const decideInventoryAgentAction = async (req, res) => {
  const decision = req.body?.decision;
  if (!['approve', 'reject'].includes(decision)) return res.status(400).json({ message: "decision must be approve or reject" });
  try {
    const verb = decision === 'approve' ? 'approved' : 'rejected';
    const { rows } = await pool.query(`UPDATE inventory_agent_actions SET status = $1, ${verb}_by = $2, ${verb}_at = now(), updated_at = now()
      WHERE id = $3::uuid AND tenant_id = $4 AND status = 'proposed' RETURNING *`, [verb, req.authContext.userId, req.params.actionId, req.authContext.tenantId]);
    if (!rows[0]) return res.status(409).json({ message: "Action is no longer available for this decision" });
    return res.json({ action: actionView(rows[0]) });
  } catch (error) { return sendBackendError(res, "Failed to record action decision", error); }
};

export const executeInventoryAgentAction = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`SELECT * FROM inventory_agent_actions WHERE id = $1::uuid AND tenant_id = $2 FOR UPDATE`, [req.params.actionId, req.authContext.tenantId]);
    const action = result.rows[0];
    if (!action) { await client.query('ROLLBACK'); return res.status(404).json({ message: "Action not found" }); }
    if (action.status === 'executed') { await client.query('COMMIT'); return res.json({ action: actionView(action), duplicate: true }); }
    if (action.status !== 'approved') { await client.query('ROLLBACK'); return res.status(409).json({ message: "Only approved actions can be executed" }); }
    const rec = action.recommendation;
    if (rec?.proposedAction?.type !== 'record_replenishment' || !Number.isInteger(rec.proposedAction.quantity) || rec.proposedAction.quantity <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ message: "Unsupported action" }); }
    await client.query(`UPDATE inventory_agent_actions SET status='executing', updated_at=now() WHERE id=$1::uuid AND tenant_id=$2 AND status='approved'`, [action.id, req.authContext.tenantId]);
    await client.query('COMMIT');
    const adjustment = await adjustProductStock(req.authContext.tenantId, action.product_id, { mode: 'adjust', quantity: rec.proposedAction.quantity, expectedStock: rec.currentStock, reason: `Inventory Agent approved replenishment (${action.id})` });
    if (adjustment.staleStock) {
      const stale = await pool.query(`UPDATE inventory_agent_actions SET status='stale', execution_result=$1::jsonb, updated_at=now() WHERE id=$2::uuid AND tenant_id=$3 AND status='executing' RETURNING *`, [JSON.stringify({ message: 'Stock changed since analysis', availableStock: adjustment.availableStock }), action.id, req.authContext.tenantId]);
      return res.status(409).json({ message: "Stock changed since analysis; rerun the agent before executing.", action: actionView(stale.rows[0]) });
    }
    const updated = await pool.query(`UPDATE inventory_agent_actions SET status='executed', executed_by=$1, executed_at=now(), execution_result=$2::jsonb, updated_at=now() WHERE id=$3::uuid AND tenant_id=$4 AND status='executing' RETURNING *`, [req.authContext.userId, JSON.stringify(adjustment), action.id, req.authContext.tenantId]);
    if (!updated.rows[0]) return res.status(409).json({ message: "Action execution was already finalized" });
    return res.json({ action: actionView(updated.rows[0]) });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return sendBackendError(res, "Failed to execute inventory action", error); } finally { client.release(); }
};

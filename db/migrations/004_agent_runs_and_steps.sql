-- 004_agent_runs_and_steps.sql
-- Additive migration for OpsPulse multi-agent execution tracking and auditability.
-- This migration is intentionally additive, tenant-scoped, and safe to re-run.

-- ============================================================
-- Table: agent_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
  user_id VARCHAR(128) NOT NULL,
  thread_id VARCHAR(128) NOT NULL,
  trigger_type VARCHAR(32) NOT NULL DEFAULT 'on_demand'
    CHECK (trigger_type IN ('on_demand', 'scheduled', 'event')),
  trigger_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  question TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial', 'cancelled')),
  execution_plan JSONB,
  selected_agents JSONB DEFAULT '[]'::jsonb,
  final_answer TEXT,
  confidence NUMERIC(5, 4),
  limitations JSONB DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_status
  ON agent_runs(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_id
  ON agent_runs(thread_id);

CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at
  ON agent_runs(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_user
  ON agent_runs(tenant_id, user_id);

-- ============================================================
-- Table: agent_steps
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
  step_number INTEGER NOT NULL CHECK (step_number >= 0),
  agent_name VARCHAR(64) NOT NULL,
  node_name VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  input_payload JSONB,
  output_payload JSONB,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  UNIQUE (run_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run_step
  ON agent_steps(run_id, step_number);

CREATE INDEX IF NOT EXISTS idx_agent_steps_tenant
  ON agent_steps(tenant_id);

CREATE INDEX IF NOT EXISTS idx_agent_steps_agent_name
  ON agent_steps(agent_name);

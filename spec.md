# OpsPulse --- Product & Technical Specification

**Version:** 1.2\
**Status:** Architecture finalized; implementation not yet authorized\
**Product:** Retail Decision Intelligence Platform\
**Audience:** Engineering implementation agent (Antigravity) and project
developers

## 1. Purpose and current status

This document defines the product direction, architecture, agent system,
forecasting strategy, implementation phases, engineering constraints and
immediate outstanding work for OpsPulse.

**This is a specification, not an instruction to implement
immediately.** The first task is a read-only repository audit. Do not
modify code, configuration, dependencies, database schemas or data until
the audit and implementation plan have been reviewed and explicitly
approved.

## 2. Product vision

OpsPulse is an AI-powered Retail Decision Intelligence Platform. It
helps retailers progress through five levels:

1.  **Descriptive:** What happened?
2.  **Diagnostic:** Why did it happen?
3.  **Predictive:** What might happen next?
4.  **Prescriptive:** What should the business do?
5.  **Decision execution:** What action should be taken, subject to
    human approval?

OpsPulse is not merely a chatbot with multiple agents. It is a
decision-support system built on deterministic analytics, forecasting,
evidence retrieval, specialist agents, controlled tools and human
approval.

### Core product modules

1.  **Business Overview:** KPIs, revenue/sales trends, inventory
    indicators, forecasts and business health.
2.  **Business Intelligence:** product analytics, sales/customer
    insights, comparisons, profitability where source data supports it,
    and custom charts.
3.  **AI Agent Centre:** specialist agents, investigations,
    recommendations, run history and execution status.
4.  **Scenario Lab:** what-if analysis for demand, pricing, discounts,
    budgets and inventory.
5.  **Intelligence & Monitoring:** anomaly detection, proactive alerts,
    briefings and forecast drift.
6.  **Data & Integrations:** CSV/Excel ingestion, validation,
    documentation and future external integrations.

## 3. Finalized architecture decisions

  -----------------------------------------------------------------------
  Decision                            Final choice
  ----------------------------------- -----------------------------------
  Product direction                   Retail Decision Intelligence
                                      Platform

  Agent architecture                  Supervisor-led multi-agent system

  Orchestration                       LangGraph inside the existing
                                      FastAPI service

  Agent execution                     Hybrid: on-demand and scheduled

  Agent autonomy                      Approval-based

  Initial specialists                 Business Analyst and Inventory
                                      Agent

  Data access                         Controlled, typed tool registry

  Business facts                      PostgreSQL/Supabase

  Document retrieval                  PostgreSQL + pgvector

  Forecasting                         Existing Python ML engine, subject
                                      to model evaluation

  Checkpoint persistence              PostgreSQL

  Scheduling                          PostgreSQL-backed scheduler within
                                      FastAPI

  Application services                Exactly three: React/Vite,
                                      Node/Express, Python/FastAPI

  Authentication                      Existing Firebase authentication
                                      through Node

  Cache/queue additions               No Redis in the planned
                                      architecture

  Other database                      No MongoDB runtime
  -----------------------------------------------------------------------

### Three-service architecture

**React + Vite frontend** - Business dashboard and analytics. - Agent
Centre. - Approval inbox. - Scenario Lab. - Monitoring and scheduled
workflow configuration. - Run history, findings, evidence and
recommendations.

**Node.js + Express backend** - Public API and Firebase ID-token
verification. - Authorization and tenant isolation. - Public agent-run,
approval and monitoring endpoints. - Trusted internal calls to
FastAPI. - Approval validation and deterministic action execution. -
Audit of approval and execution decisions.

**Python + FastAPI ML service** - LangGraph orchestration. - Supervisor
and specialist agents. - RAG and pgvector retrieval. - Deterministic
analytics tools. - Forecasting and model evaluation. - Scenario
calculations. - Scheduled monitoring execution.

**PostgreSQL/Supabase + pgvector** - Existing retail data. - Document
chunks and embeddings. - Agent runs and steps. - Recommendations and
approvals. - Monitoring rules and events. - Audit records. - LangGraph
checkpoints.

LangGraph is a library inside the existing FastAPI application, not a
fourth service. Do not introduce Redis, MongoDB, a separate scheduler
service or separate agent microservices.

## 4. Forecasting model strategy

### Existing models

The current product has three forecasting models: - ARIMA - Prophet -
Random Forest

There is no approved decision yet to delete any model. The production
shortlist must be selected using consistent backtesting.

### Model characteristics

  --------------------------------------------------------------------------------
  Model             Strengths         Limitations              Evaluation role
  ----------------- ----------------- ------------------------ -------------------
  ARIMA             Classical         Requires appropriate     Baseline/optional
                    univariate        stationarity/parameter   fallback
                    time-series       handling; limited native 
                    baseline;         handling of complex      
                    captures          seasonality and external 
                    autocorrelation   features                 
                    and stable                                 
                    temporal patterns                          

  Prophet           Trend and         Can be unreliable on     Primary time-series
                    seasonal          sparse or short product  candidate
                    components;       histories; not           
                    holiday/event     universally superior to  
                    support;          ARIMA                    
                    interpretable                              
                    decomposition                              

  Random Forest     Nonlinear         Requires feature         Feature-based
                    relationships     engineering; does not    candidate
                    using lag,        inherently model         
                    rolling, calendar temporal order; needs    
                    and other         enough training examples 
                    engineered                                 
                    features                                   
  --------------------------------------------------------------------------------

### Provisional recommendation

The provisional production shortlist is **Prophet + Random Forest**.
ARIMA should be excluded from the default production prediction path
only after evaluation. Do not delete its implementation during the
initial audit.

This is a hypothesis to test, not a predetermined result. ARIMA may
outperform Prophet for short, irregular or non-seasonal histories.

### Required model evaluation

1.  Run all three models against the same historical cut-off dates.
2.  Use rolling-origin / walk-forward validation. Never randomly shuffle
    time-series observations.
3.  Use identical forecast horizons and comparable training windows.
4.  Evaluate per product and across the catalogue.
5.  Include sparse, intermittent and higher-volume demand profiles.
6.  Record model coverage and failures, not only accuracy on successful
    products.
7.  Compare runtime and operational complexity.
8.  Document selection criteria and results before changing production
    routing.

Metrics: - **MAE:** mean absolute error. - **RMSE:** root mean squared
error. - **WAPE:** weighted absolute percentage error, with explicit
handling for zero/near-zero actual totals. - **Forecast bias:**
systematic over- or under-forecasting. - **Coverage:** percentage of
products for which a model produces an eligible forecast. - **Runtime:**
forecast generation duration.

Define minimum-data eligibility rules. Report both per-product and
aggregate results so high-volume products do not hide poor performance
on smaller products.

### Forecasting rules

-   Forecast calculations and model selection must be deterministic, not
    delegated to an LLM.
-   LLMs may explain model results and business implications.
-   Clearly distinguish actual sales from predicted demand.
-   Preserve forecast horizon, generation timestamp, model name/version
    and validation metrics.
-   Do not assume all products should use the same model.
-   A deterministic model-selection policy may select a model per
    product or product segment after evaluation.
-   Do not remove ARIMA code, dependencies or endpoints until usage and
    compatibility have been audited and removal approved.

## 5. Multi-agent architecture

### Supervisor-led specialist agents

The supervisor interprets the request, chooses the minimum useful set of
specialists, defines an execution plan and allocates bounded resources.
It must not invoke every agent for every question.

  -----------------------------------------------------------------------
  Agent                   Responsibility          Restrictions
  ----------------------- ----------------------- -----------------------
  Supervisor              Intent interpretation,  No arbitrary SQL; must
                          planning, specialist    not invent findings
                          selection, budget       
                          allocation and routing  

  Business Analyst        Sales trends, product   Cannot modify inventory
                          performance, KPIs and   
                          comparisons             

  Inventory Agent         Demand, inventory risk, Cannot commit stock
                          stockout/overstock      changes
                          analysis and reorder    
                          recommendations         

  Financial Analyst       Revenue, costs, margins Must not invent missing
                          and profitability where costs or margins
                          supported by source     
                          data                    

  Anomaly Investigator    Detect unusual patterns Must not label ordinary
                          and investigate         deviations as fraud
                          contributing factors    

  Data Quality Agent      Detect missing,         Must not silently
                          invalid, stale or       repair business records
                          inconsistent data       

  Reporting Agent         Consolidate specialist  Must not introduce
                          findings into executive unsupported conclusions
                          reports                 
  -----------------------------------------------------------------------

Initial implementation scope: - Supervisor - Business Analyst -
Inventory Agent

Add other specialists only after the first two agents are tested and
stable.

### Example routing

  -----------------------------------------------------------------------
  User request                        Expected agents
  ----------------------------------- -----------------------------------
  Best-selling products               Business Analyst

  Why are almonds underperforming?    Business Analyst + Inventory Agent

  Which products are hurting          Business Analyst + Financial
  profitability?                      Analyst

  Why did sales spike?                Business Analyst + Anomaly
                                      Investigator

  Is my sales data reliable?          Data Quality Agent

  Prepare weekly business report      Relevant specialists + Reporting
                                      Agent
  -----------------------------------------------------------------------

### Graph flow

``` text
START
  -> initialize_context
  -> validate_request
  -> supervisor_plan
  -> route_specialists
  -> specialist nodes (parallel when independent)
  -> collect_findings
  -> validate_evidence
  -> synthesize
  -> recommendation?
       yes -> prepare_action -> pending_approval -> END
       no  -> response -> END
```

Individual agent failures should produce explicit partial results where
possible rather than automatically failing the whole graph.

## 6. LangGraph state design

Use typed graph state and Pydantic models for structured input/output.
This is a logical contract; it does not require every field to become a
database column.

``` python
class OpsPulseState(TypedDict):
    # Identity
    run_id: str
    thread_id: str
    tenant_id: str
    user_id: str

    # Trigger
    trigger_type: str  # on_demand | scheduled | event
    trigger_metadata: dict

    # Request
    question: str
    conversation_context: list

    # Planning
    intent: str
    execution_plan: dict
    selected_agents: list[str]

    # Execution
    agent_status: dict
    agent_findings: list[dict]
    tool_execution_log: list[dict]

    # Evidence
    retrieved_documents: list[dict]
    sql_evidence: list[dict]
    prediction_evidence: list[dict]

    # Validation
    evidence_valid: bool
    validation_errors: list[str]
    confidence: float | None

    # Response
    final_answer: str
    citations: list[dict]
    recommendations: list[dict]

    # Approval
    proposed_actions: list[dict]
    approval_required: bool
    approval_status: str | None

    # Controls
    execution_budget: dict
    errors: list[dict]
    status: str
```

State ownership: - Identity and tenant: trusted server-side request
context; immutable. - Question: request initializer; immutable. - Plan
and selected agents: supervisor. - Findings: respective specialists. -
Evidence: retrieval/tools and validation nodes. - Final answer:
synthesis node. - Approval state: application approval service, never an
LLM. - Execution status: orchestration/application lifecycle.

Rules: - Each execution gets a unique `run_id`. - `thread_id` identifies
a resumable conversation/workflow. - `tenant_id` comes from
authenticated server context, never prompt text or LLM tool arguments. -
Do not store credentials, unrestricted conversation history or
unnecessary raw database rows in graph state. - Bound conversation
context and summarize older history. - Store large evidence payloads in
PostgreSQL and reference them by ID where appropriate.

### Checkpointing

Use a compatible LangGraph PostgreSQL checkpointer for durable
execution.

Keep separate: 1. **Graph checkpoints:** state required to resume a
graph. 2. **OpsPulse application records:** business-level run history,
findings, recommendations, approvals and audit trail.

Do not treat checkpoint tables as the application audit log. Validate
package compatibility and checkpoint lifecycle before choosing final
dependency versions.

## 7. Agent contracts

All specialists must use a common structured contract and must not
return only free-form prose.

``` python
class AgentInput(BaseModel):
    run_id: str
    tenant_id: str
    question: str
    context: dict
    allowed_tools: list[str]


class EvidenceReference(BaseModel):
    evidence_id: str
    source_type: str
    source_name: str
    record_reference: str | None
    observed_at: datetime | None


class AgentFinding(BaseModel):
    agent_name: str
    status: str
    summary: str
    findings: list[dict]
    evidence: list[EvidenceReference]
    confidence: float | None
    limitations: list[str]
    recommended_next_steps: list[str]


class AgentOutput(BaseModel):
    run_id: str
    finding: AgentFinding
    execution_metadata: dict
```

Allowed statuses: - `completed` - `insufficient_evidence` - `partial` -
`failed` - `skipped`

Every material claim should be traceable to evidence or explicitly
marked as interpretation. Agents must state limitations and missing
evidence.

## 8. Controlled tool registry

Agents must not connect directly to PostgreSQL and must never receive
unrestricted SQL execution capability.

### Tool execution path

``` text
Specialist Agent
  -> Tool Registry
  -> Permission Validation
  -> Trusted Tenant Scope
  -> Input Schema Validation
  -> Deterministic Tool
  -> PostgreSQL / Existing ML Engine
  -> Structured Evidence Result
```

### Initial read-only tools

  -----------------------------------------------------------------------------
  Tool                          Purpose                 Initial authorized
                                                        agents
  ----------------------------- ----------------------- -----------------------
  `get_sales_summary`           Sales totals and trends Business, Financial

  `compare_sales_periods`       Compare date windows    Business, Financial

  `get_product_performance`     Product-level metrics   Business, Inventory

  `get_product_snapshot`        Product, sales,         Business, Inventory
                                forecast and alert      
                                snapshot                

  `get_inventory_risk`          Stockout/overstock risk Inventory

  `get_demand_forecast`         Retrieve existing ML    Inventory, Business
                                forecasts               

  `get_profitability_metrics`   Calculate supported     Financial
                                profitability metrics   

  `detect_sales_anomalies`      Identify unusual        Anomaly
                                patterns                

  `get_data_quality_report`     Completeness and        Data Quality
                                consistency checks      

  `search_business_documents`   pgvector document       Authorized agents
                                retrieval               

  `get_business_kpis`           Approved KPI            Business, Financial,
                                calculations            Reporting
  -----------------------------------------------------------------------------

Each tool requires: - Pydantic input and output schemas. - Trusted
tenant scope injected by the execution layer. - Explicit agent
permissions. - Parameterized SQL. - Query timeouts and row limits. -
Sanitized execution logs. - Deterministic calculations where possible.

Do not expose a generic `execute_sql` tool. Enforce permissions in code,
not merely in prompts.

Write tools are out of scope for the initial read-only foundation.
Future actions such as reorder changes, purchase-order drafts or
discount proposals must use a separate action registry and
approval-enforced execution path.

## 9. Hybrid execution

The same graph supports: 1. **On-demand:** user asks a question or
requests an investigation. 2. **Scheduled:** configured daily/weekly
workflow runs automatically. 3. **Event-driven:** a detected business
condition initiates an investigation; introduce after basic scheduled
execution.

### Scheduler architecture

Use PostgreSQL-backed schedules and a scheduler running inside the
existing FastAPI process.

``` text
monitoring_rules in PostgreSQL
  -> FastAPI scheduler
  -> atomically claim due schedule
  -> create agent_run
  -> invoke LangGraph
  -> persist findings
  -> surface result in dashboard
```

Safeguards: - Database locking/atomic claiming to avoid duplicate work
across workers. - Idempotency key per scheduled occurrence. - Prevent
overlapping runs unless explicitly configured. - Persist next execution
time. - Record failures and duration. - Tenant-specific quotas and
execution budgets. - Pause, resume and disable controls.

Initial scheduled workflows: - Daily business briefing. - Daily
inventory risk review. - Daily sales anomaly scan. - Daily or weekly
forecast drift check. - Weekly executive report.

Cadences should eventually be user-configurable. Do not create a
separate scheduler service.

## 10. Approval-based autonomy

Agents can investigate, calculate, recommend and prepare actions. They
cannot independently execute consequential business changes.

### Workflow

1.  Agent identifies an opportunity or risk.
2.  Agent prepares a structured recommendation.
3.  Proposed action is stored as pending approval.
4.  User reviews and approves, rejects or requests revision.
5.  Node validates identity, role, tenant, approval state and action
    parameters.
6.  A deterministic service executes the authorized action.
7.  Result and actor are recorded in the audit trail.

### Proposed action schema

``` python
class ProposedAction(BaseModel):
    action_id: str
    action_type: str
    title: str
    description: str
    target_entity: dict
    proposed_parameters: dict
    rationale: str
    expected_impact: dict
    evidence_ids: list[str]
    requires_approval: bool = True
    status: str = "pending_approval"
```

Clearly distinguish observed facts, forecasts, agent interpretations,
proposed changes and uncertain expected impact.

### Approval state machine

``` text
DRAFT
  -> PENDING_APPROVAL
      -> REJECTED
      -> EXPIRED
      -> APPROVED
          -> EXECUTING
              -> EXECUTED
              -> FAILED
```

Approval decisions must be auditable. Any changed action parameters
require revalidation and, where material, a new approval. Approval must
not authorize arbitrary parameters generated after the approval
decision.

## 11. Database design

Do not create every proposed table at once. Inspect the existing schema
and add tables incrementally.

  -------------------------------------------------------------------------
  Proposed table            Purpose                 Phase
  ------------------------- ----------------------- -----------------------
  `agent_runs`              Run identity, tenant,   Phase 1
                            trigger, status and     
                            timing                  

  `agent_steps`             Graph node/specialist   Phase 1
                            execution history       

  `agent_recommendations`   Structured findings and Later Phase 2/3
                            proposed actions        

  `agent_approvals`         Approval decisions and  Phase 3
                            execution state         

  `agent_audit_logs`        Security-sensitive      Incremental foundation
                            actions and decisions   

  `monitoring_rules`        Scheduled workflow      Phase 5
                            configuration           

  `monitoring_events`       Triggered conditions    Phase 5
                            and resulting events    

  `business_insights`       Persisted business      Later
                            insights                

  `scenario_runs`           Scenario inputs,        Phase 4
                            outputs and comparisons 
  -------------------------------------------------------------------------

Logical relationships:

``` text
agent_runs
  +-- agent_steps
  +-- agent_recommendations
        +-- agent_approvals
  +-- agent_audit_logs

monitoring_rules
  +-- monitoring_events
        +-- agent_runs
```

Design requirements: - Tenant scope on all tenant-owned records. -
Normal indexed columns for IDs, ownership, status and timestamps. -
JSONB for variable findings/action parameters where suitable. - Database
constraints and transactions for state transitions. - Idempotency keys
for scheduled runs and action execution. - Indexes for tenant, status,
created time and run ID. - Use RLS where appropriate, but not as a
substitute for API/tool authorization. - Keep LangGraph checkpoint
persistence distinct from application tables.

No migrations or data changes are authorized by this specification.

## 12. Phase 1 --- Reliable Intelligence Foundation

Phase 1 prepares the existing platform for multi-agent development. It
does not implement the full multi-agent system.

### P1. Existing-system audit

-   Map current AI Analyst request flow.
-   Inspect frontend, backend and ML-service API contracts.
-   Inspect current RAG, retrieval and provider integration.
-   Identify reusable SQL queries and analytics calculations.
-   Inspect forecasting implementations and model routing.
-   Inspect database schema and data relationships.
-   Verify Firebase and internal service authentication.
-   Establish baseline tests and performance.
-   Document working features and compatibility requirements.

### P2. Forecast model evaluation

-   Backtest ARIMA, Prophet and Random Forest using identical rolling
    historical windows.
-   Evaluate MAE, RMSE, WAPE, bias, coverage and runtime.
-   Report per-product and aggregate performance.
-   Define eligibility/minimum-data rules.
-   Recommend a production shortlist.
-   Do not remove ARIMA or change production routing before results are
    reviewed and approved.

### P3. Analytics tool foundation

-   Identify and extract reusable business calculations where
    appropriate.
-   Define typed tool input/output schemas.
-   Prepare sales, product, inventory and prediction retrieval tools.
-   Enforce trusted tenant-scoped access.
-   Add timeouts, row limits and query validation.
-   Compare tool outputs with existing dashboard values.

### P4. Evidence and provenance

-   Standardize SQL evidence references.
-   Standardize pgvector document references.
-   Include timestamps and source metadata.
-   Define evidence validation.
-   Define confidence and limitation semantics.
-   Ensure answers distinguish actuals, forecasts and interpretations.

### P5. Agent execution foundation

-   Define `agent_runs` and `agent_steps` requirements.
-   Define run lifecycle and statuses.
-   Track start/end time, duration, failure reason and available token
    usage.
-   Define execution budgets and limits.
-   Establish correlation IDs and secret-safe logging.

### P6. Authorization foundation

-   Define trusted tenant-context propagation from Node to FastAPI.
-   Validate user and internal-service identity.
-   Define tool-level permission policies.
-   Ensure agents cannot override tenant scope.
-   Define future approval authorization requirements.
-   Test cross-tenant access prevention.

### P7. LangGraph preparation

-   Check Python/runtime compatibility.
-   Select compatible LangGraph and PostgreSQL checkpoint package
    versions.
-   Define graph state and agent contracts.
-   Define a minimal graph test.
-   Validate PostgreSQL checkpoint persistence in an isolated
    development test.
-   Do not migrate the existing AI Analyst to LangGraph until
    compatibility and regression strategy are agreed.

### Phase 1 acceptance criteria

  -----------------------------------------------------------------------
  Deliverable                         Acceptance criteria
  ----------------------------------- -----------------------------------
  Analytics tools                     Deterministic, validated results;
                                      dashboard parity

  Evidence schema                     Material claims trace to SQL,
                                      forecast or document evidence

  Execution records                   Consistent run/step lifecycle and
                                      statuses

  Tenant security                     Cross-tenant access is rejected

  Observability                       Errors, duration and usage
                                      traceable without secrets

  LangGraph compatibility             Minimal graph executes and persists
                                      state

  Regression safety                   Existing dashboard, AI Analyst and
                                      prediction APIs remain functional

  Model decision                      Reproducible comparison and
                                      documented recommendation
  -----------------------------------------------------------------------

### Phase 1 regression tests

-   Existing dashboard metrics match analytics tool outputs.
-   Product-specific questions retrieve correct product facts.
-   Multi-product comparisons use consistent date windows.
-   Forecasts are distinguished from actual sales.
-   Missing data produces explicit limitations.
-   No-evidence questions do not produce fabricated claims.
-   Invalid tenant scope is rejected.
-   Unauthorized tools are rejected.
-   Graph state can be resumed from a checkpoint.
-   Existing API contracts remain compatible.
-   Provider errors remain distinguishable and diagnostics remain
    sanitized.

The existing AI Analyst provider empty-answer fix must remain covered by
tests. Do not replace it with an agent architecture rewrite.

## 13. Later implementation roadmap

  -----------------------------------------------------------------------
  Phase                   Scope                   Outcome
  ----------------------- ----------------------- -----------------------
  Phase 1                 Reliable intelligence   Analytics tools,
                          foundation              evidence,
                                                  authorization,
                                                  execution tracking and
                                                  model evaluation

  Phase 2                 LangGraph supervisor    Supervisor, Business
                          and first specialists   Analyst and Inventory
                                                  Agent

  Phase 3                 Prescriptive            Inventory risk, reorder
                          intelligence and        recommendations and
                          approvals               approval workflow

  Phase 4                 Scenario Lab            What-if analysis,
                                                  demand simulation and
                                                  inventory optimization

  Phase 5                 Proactive intelligence  Scheduled monitoring,
                                                  briefings, anomaly
                                                  investigation and
                                                  forecast drift

  Phase 6                 Advanced agents and     Financial, reporting,
                          integrations            data quality, customer
                                                  intelligence and
                                                  external integrations
  -----------------------------------------------------------------------

Phase 2 should remain small: one Supervisor, one Business Analyst, one
Inventory Agent, limited read-only tools, evidence validation,
synthesis, PostgreSQL checkpoint persistence and Agent Centre run
status/findings. Do not implement all specialists simultaneously.

## 14. Existing functionality to preserve

The implementation agent must discover the actual repository state and
produce a preservation inventory. Known existing capabilities include: -
React/Vite dashboard and KPI cards. - Existing sales and product data. -
Existing predictions and forecasting endpoints. - ARIMA, Prophet and
Random Forest implementations. - Existing model comparison capability. -
Existing alerts. - FastAPI ML service. - Node/Express backend. -
Firebase authentication. - PostgreSQL/Supabase and pgvector. - AI
Analyst with SQL + document retrieval and provider-backed responses. -
Existing RAG provider diagnostics and empty-answer handling changes.

Do not assume every item is currently deployed or functioning; verify
during the audit. Preserve the three-application-service architecture
unless the product owner explicitly changes it.

## 15. Engineering and safety rules

1.  Do not implement arbitrary SQL generation/execution by agents.
2.  Do not let agents access PostgreSQL directly.
3.  Do not let an LLM decide authorization or tenant identity.
4.  Do not let agents independently execute consequential business
    changes.
5.  Do not fabricate missing sales, costs, margins, inventory or
    forecasts.
6.  Do not present forecasts as actuals or expected impact as
    guaranteed.
7.  Use deterministic calculations for business metrics and model
    selection.
8.  Use SQL for live business facts and pgvector for
    documentation/knowledge retrieval.
9.  Bound agent tool calls, runtime, retries, context size and model
    usage.
10. Use graceful degradation for specialist failures.
11. Make scheduled execution idempotent and tenant-scoped.
12. Record who requested, approved and executed consequential actions.
13. Preserve existing API contracts and working functionality.
14. Do not expose secrets, provider keys, tokens, sensitive prompts or
    raw business records in logs.
15. Do not perform destructive changes, migrations, reseeding, database
    data edits, dependency upgrades or commits without explicit
    approval.
16. Do not overwrite or revert unrelated user changes in the working
    tree.

## 16. Immediate next actions --- before implementation

Immediate work is limited to planning and verification:

1.  **Read-only repository audit** against this specification.
2.  **Forecasting benchmark plan and evaluation** for ARIMA, Prophet and
    Random Forest.
3.  **Live AI Analyst verification** of the existing provider
    empty-answer fix, using configured provider environment without
    exposing credentials.
4.  **Preservation inventory** of current frontend features, API
    contracts, database tables, RAG, forecasting and tests.
5.  **Phase 1 implementation plan** with exact files, proposed changes,
    risks, dependencies and tests.
6.  **Database impact assessment** identifying existing versus genuinely
    new tables and migration requirements.

Do not begin implementation phases until these outputs have been
reviewed and approved.

### Expected output of the initial read-only audit

The implementation agent must return: - Current repository structure and
service boundaries. - Existing functionality inventory. - Existing
forecasting model flow and model-comparison results available in the
repository. - Existing database schema summary, without modifying it. -
Existing AI Analyst/RAG request and authentication flow. - Test baseline
and known failures. - Gaps against each Phase 1 requirement. -
File-by-file proposed changes. - Proposed database changes, clearly
separated from existing schema. - Risks, compatibility concerns and
validation plan. - Prioritized implementation sequence.

**The audit must not edit files, install packages, run migrations, seed
data, change environment files, commit or deploy.**

## 17. Definition of success

OpsPulse is ready to expand into a multi-agent decision-intelligence
platform when: - Analytics and forecasting outputs are measurable and
reproducible. - Forecast model selection is supported by backtesting. -
Business claims are grounded in traceable evidence. - Agent execution is
observable and resumable. - Tenant and tool permissions are enforced
outside the LLM. - Specialists collaborate through a bounded LangGraph
workflow. - Recommendations are distinct from executed actions. -
Consequential actions require independently validated human approval. -
On-demand and scheduled runs share the same security and execution
controls. - Existing product functionality remains intact.

**Current status: Architecture and product direction finalized. Next
step: read-only audit and model evaluation. No implementation is
authorized yet.**

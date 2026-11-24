"""Focused, read-only LangGraph inventory investigation."""
from __future__ import annotations
import time, uuid
from typing import Any
from langgraph.graph import START, END, StateGraph
from contracts.state import OpsPulseState
from tracking.tracker import default_tracker
from workflow.minimal_graph import CheckpointerManager, default_checkpointer_manager

_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

def investigate(state: OpsPulseState) -> dict[str, Any]:
    started = time.perf_counter(); health = state.get("inventory_health") or {}
    default_tracker.record_step(state["run_id"], state["tenant_id"], 1, "inventory_agent", "inspect_inventory_intelligence", "completed", {}, health, [{"tool_name":"inventory_intelligence", "success":True}], int((time.perf_counter()-started)*1000))
    return {"inventory_result": health}

def prioritize(state: OpsPulseState) -> dict[str, Any]:
    horizon = int(state.get("inventory_horizon_days", 30)); raw = state.get("inventory_result") or {}; recommendations = []
    for row in raw.get("products") or []:
        stock, expected, threshold = int(row.get("currentStock") or 0), row.get("expectedDemand"), int(row.get("reorderThreshold") or 10)
        available = row.get("forecastStatus") == "available"; stockout, low, over = bool(row.get("stockoutRisk")), bool(row.get("lowStock")), bool(row.get("overstock"))
        if not (stockout or low or over or not available): continue
        risk = "stockout_risk" if stockout else "low_stock" if low else "overstock" if over else "forecast_missing"; severity = "critical" if stockout and stock == 0 else "high" if stockout else "medium" if low else "low"
        quantity = row.get("recommendedReorderQuantity") if available else None
        proposal = {"type":"record_replenishment", "quantity":quantity, "requiresApproval":True, "description":"Record stock received only after confirming the physical replenishment."} if stockout and quantity else None
        explanation = f"Current stock ({stock}) is below expected demand ({expected}) over {horizon} days." if stockout else f"Current stock ({stock}) is at or below the reorder threshold ({threshold})." if low else f"Current stock ({stock}) is at least twice expected demand ({expected}) over {horizon} days." if over else "No persisted forecast is available, so demand-based risk cannot be calculated."
        recommendations.append({"product":{"id":row.get("id"),"name":row.get("name"),"category":row.get("category")},"currentStock":stock,"forecastDemand":expected,"forecastHorizonDays":row.get("forecastHorizonDays"),"riskClassification":risk,"severity":severity,"explanation":explanation,"suggestedAction":proposal["description"] if proposal else "Review replenishment and demand coverage." if risk != "overstock" else "Pause replenishment and review sell-through.","suggestedReorderQuantity":quantity,"proposedAction":proposal,"evidence":{"source":"persisted_inventory_intelligence","reorderThreshold":threshold,"forecastStatus":row.get("forecastStatus"),"predictionGeneratedAt":row.get("predictionGeneratedAt"),"daysOfCover":row.get("daysOfCover")}})
    recommendations.sort(key=lambda r: (_ORDER[r["severity"]], r["product"]["name"] or "")); limitations = list(raw.get("limitations") or [])
    if any(r["riskClassification"] == "forecast_missing" for r in recommendations): limitations.append("Products without persisted forecasts cannot receive demand-based recommendations.")
    return {"recommendations":recommendations,"limitations":limitations}

def finalize(state: OpsPulseState) -> dict[str, Any]:
    recommendations, limitations = state.get("recommendations") or [], state.get("limitations") or []; answer = f"Inventory analysis found {len(recommendations)} prioritized finding(s)."
    default_tracker.update_run_status(state["run_id"], "completed", answer, .9 if recommendations else .7, limitations, ["inventory_agent"], {"intent":"inventory_investigation","horizon_days":state.get("inventory_horizon_days",30)}, tenant_id=state["tenant_id"])
    return {"final_answer":answer,"status":"completed","selected_agents":["inventory_agent"],"approval_required":any(r.get("proposedAction") for r in recommendations)}

def run_inventory_agent(tenant_id: str, user_id: str, horizon_days: int, inventory_health: dict[str, Any]) -> OpsPulseState:
    run_id=str(uuid.uuid4()); default_tracker.create_run(run_id,tenant_id,user_id,run_id,"Inventory analysis","on_demand")
    graph=StateGraph(OpsPulseState); graph.add_node("investigate",investigate); graph.add_node("prioritize",prioritize); graph.add_node("finalize",finalize); graph.add_edge(START,"investigate"); graph.add_edge("investigate","prioritize"); graph.add_edge("prioritize","finalize"); graph.add_edge("finalize",END)
    return graph.compile(checkpointer=default_checkpointer_manager.get_saver()).invoke({"run_id":run_id,"thread_id":run_id,"tenant_id":tenant_id,"user_id":user_id,"question":"Inventory analysis","inventory_horizon_days":horizon_days,"inventory_health":inventory_health},{"configurable":{"thread_id":CheckpointerManager.namespace_thread_id(tenant_id,run_id,user_id)}})

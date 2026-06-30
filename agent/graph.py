from langgraph.graph import StateGraph, END
from agent.state import AgentState
from agent.nodes import (
    orchestrator, fleet_manager, config_builder,
    yaml_validator, human_review, rollout_agent,
    ack_monitor, summarizer, audit_logger,
    query_node, handle_error, handle_abort
)

def route_after_orchestrator(state: AgentState):
    if state.get("error"):
        return "error"
        
    intent = state.get("parsed_intent", {})
    action = intent.get("action", "UNKNOWN")
    
    if action == "UNKNOWN":
        return "error"
        
    if action in ("FETCH_AUDIT_LOGS", "QUERY_STATUS"):
        return "query_flow"
        
    if action in ("CREATE_FLEET_ONLY", "ASSIGN_AGENTS_TO_FLEET") or intent.get("requires_new_fleet"):
        return "needs_fleet"
    elif intent.get("requires_new_config") or action == "ROLLOUT_EXISTING_CONFIG":
        return "skip_fleet"
    else:
        return "error"

def route_after_fleet_manager(state: AgentState):
    intent = state.get("parsed_intent", {})
    action = intent.get("action", "UNKNOWN")
    if action in ("CREATE_FLEET_ONLY", "ASSIGN_AGENTS_TO_FLEET"):
        return "direct_summary"
    return "continue_config"

def route_after_validation(state: AgentState):
    val = state.get("validation_result", {})
    if val.get("valid"):
        return "valid"
    return "invalid"

def route_after_human_decision(state: AgentState):
    decision = state.get("human_decision")
    if decision == "approved":
        return "approved"
    elif decision == "rejected":
        return "rejected"
    return "pending"

def build_graph(checkpointer):
    graph = StateGraph(AgentState)

    # Register all nodes
    graph.add_node("orchestrator",    orchestrator.run)
    graph.add_node("fleet_manager",   fleet_manager.run)
    graph.add_node("config_builder",  config_builder.run)
    graph.add_node("yaml_validator",  yaml_validator.run)
    graph.add_node("human_review",    human_review.run)
    graph.add_node("rollout_agent",   rollout_agent.run)
    graph.add_node("ack_monitor",     ack_monitor.run)
    graph.add_node("summarizer",      summarizer.run)
    graph.add_node("audit_logger",    audit_logger.run)
    graph.add_node("query_node",      query_node.run)
    graph.add_node("error_handler",   handle_error)
    graph.add_node("abort_handler",   handle_abort)

    # Entry point
    graph.set_entry_point("orchestrator")

    # Orchestrator routing
    graph.add_conditional_edges("orchestrator", route_after_orchestrator, {
        "needs_fleet":    "fleet_manager",
        "skip_fleet":     "config_builder",
        "query_flow":     "query_node",
        "error":          "error_handler",
    })

    # Fleet manager routing
    graph.add_conditional_edges("fleet_manager", route_after_fleet_manager, {
        "direct_summary":  "summarizer",
        "continue_config": "config_builder",
    })

    # Config builder -> YAML validator
    graph.add_edge("config_builder", "yaml_validator")

    # YAML validator -> human review or error
    graph.add_conditional_edges("yaml_validator", route_after_validation, {
        "valid":   "human_review",
        "invalid": "error_handler",
    })

    # Human review node conditional edge
    graph.add_conditional_edges("human_review", route_after_human_decision, {
        "approved": "rollout_agent",
        "rejected": "abort_handler",
        "pending":  "human_review",
    })

    # Linear execution after approval
    graph.add_edge("rollout_agent", "ack_monitor")
    graph.add_edge("ack_monitor",   "summarizer")
    graph.add_edge("summarizer",    "audit_logger")
    graph.add_edge("audit_logger",  END)
    
    # Query flow continues to audit logger
    graph.add_edge("query_node",    "audit_logger")

    # Handlers terminate
    graph.add_edge("error_handler", END)
    graph.add_edge("abort_handler", END)

    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["human_review"]
    )

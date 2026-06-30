from agent.state import AgentState

def handle_error(state: AgentState) -> dict:
    error_msg = state.get("error", "An unknown error occurred during execution.")
    return {
        "status": "failed",
        "final_summary": f"Execution failed: {error_msg}. Please check the details and try again.",
        "current_node": "error_handler"
    }

def handle_abort(state: AgentState) -> dict:
    return {
        "status": "aborted",
        "final_summary": "Got it — nothing was changed. Let me know if you'd like to try again with different settings.",
        "current_node": "abort_handler"
    }

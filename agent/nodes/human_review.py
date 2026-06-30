from agent.state import AgentState

def run(state: AgentState) -> dict:
    decision = state.get("human_decision", "pending")
    
    if decision == "approved":
        return {
            "status": "running",
            "current_node": "human_review",
            "execution_log": ["[HumanReview] User approved the rollout. Proceeding..."]
        }
    elif decision == "rejected":
        return {
            "status": "aborted",
            "current_node": "human_review",
            "execution_log": ["[HumanReview] User rejected the rollout. Aborting..."]
        }
        
    return {
        "status": "awaiting_human",
        "current_node": "human_review"
    }

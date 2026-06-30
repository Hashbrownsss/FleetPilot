from agent.state import AgentState
from agent.tools.fleet_tools import create_fleet, assign_agents_to_fleet

def run(state: AgentState) -> dict:
    parsed_intent = state.get("parsed_intent", {})
    action = parsed_intent.get("action", "")
    fleet_name = parsed_intent.get("fleet_name")
    target_agents = parsed_intent.get("target_agents", [])
    user_id = state.get("user_id")
    
    if not fleet_name:
        return {
            "error": "Fleet name is missing from parsed intent.",
            "status": "failed",
            "current_node": "fleet_manager"
        }
        
    try:
        execution_log = []
        
        # 1. Create the fleet (will just update if it already exists)
        response_data = create_fleet(user_id, fleet_name)
        fleet_id = response_data.get("id") or response_data.get("fleet_id") or "unknown_id"
        execution_log.append(f"[FleetManager] Fleet verified/created: {fleet_name}")
        
        # 2. If assigning agents, assign them
        if action == "ASSIGN_AGENTS_TO_FLEET" and target_agents:
            assign_agents_to_fleet(user_id, fleet_name, target_agents)
            execution_log.append(f"[FleetManager] Assigned agents {target_agents} to fleet '{fleet_name}'")
            
        return {
            "fleet_id": str(fleet_id),
            "fleet_name": fleet_name,
            "execution_log": execution_log,
            "current_node": "fleet_manager"
        }
    except Exception as e:
        return {
            "error": f"Fleet operation failed: {str(e)}",
            "status": "failed",
            "current_node": "fleet_manager"
        }

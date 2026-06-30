from agent.state import AgentState
from agent.tools.api_client import AgentAPIClient

def run(state: AgentState) -> dict:
    if state.get("human_decision") != "approved":
        return {
            "error": "Cannot execute rollout without explicit human approval.",
            "status": "failed",
            "current_node": "rollout_agent"
        }

    parsed_intent = state.get("parsed_intent", {})
    target_agents = parsed_intent.get("target_agents", [])
    fleet_name = state.get("fleet_name") or parsed_intent.get("fleet_name")
    user_id = state.get("user_id", "admin")
    generated_yaml = state.get("generated_yaml")
    
    execution_log = []
    rollout_results = []
    
    if not generated_yaml:
        return {
            "error": "No generated YAML configuration found in state.",
            "status": "failed",
            "current_node": "rollout_agent"
        }
        
    client = AgentAPIClient(user_id)
    
    # 1. If fleet_name is specified, update the fleet configuration
    if fleet_name:
        try:
            payload = {
                "name": fleet_name,
                "description": "Auto-updated by agent rollout",
                "config": generated_yaml
            }
            res = client.post("/api/configurations", json=payload)
            if res.status_code == 200:
                execution_log.append(f"[Rollout] Successfully rolled out configuration to fleet '{fleet_name}'")
            else:
                execution_log.append(f"[Rollout] Warning: Fleet config update status {res.status_code}: {res.text}")
        except Exception as e:
            execution_log.append(f"[Rollout] Error updating fleet config: {e}")

    # 2. If target_agents are specified, push configuration directly to each target agent
    if target_agents:
        try:
            agents_res = client.get("/api/opamp/agents")
            agents_list = agents_res.json().get("agents", []) if agents_res.status_code == 200 else []
            
            for target in target_agents:
                matched_id = None
                norm_target = target.lower().replace(" ", "").replace("-", "").replace("_", "")
                
                for a in agents_list:
                    a_name = a.get("name", "")
                    a_id = a.get("id", "")
                    norm_a_name = a_name.lower().replace(" ", "").replace("-", "").replace("_", "")
                    norm_a_id = a_id.lower().replace("-", "")
                    
                    if norm_target in norm_a_name or norm_target in norm_a_id:
                        matched_id = a_id
                        break
                
                if not matched_id and len(target) >= 8:
                    matched_id = target
                    
                if matched_id:
                    res = client.post(f"/api/opamp/agent/{matched_id}/config", json={"config": generated_yaml})
                    if res.status_code == 200:
                        rollout_results.append({"agent": target, "status": "success"})
                        execution_log.append(f"[Rollout] Successfully pushed configuration override to agent {target}")
                    else:
                        rollout_results.append({"agent": target, "status": "failed", "error": res.text})
                        execution_log.append(f"[Rollout] Failed to push config override to agent {target}: {res.text}")
                else:
                    rollout_results.append({"agent": target, "status": "failed", "error": "Agent not found"})
                    execution_log.append(f"[Rollout] Could not resolve agent name or ID: {target}")
        except Exception as e:
            execution_log.append(f"[Rollout] Error pushing overrides to target agents: {e}")
            
    has_success = fleet_name or any(r.get("status") == "success" for r in rollout_results)
    
    return {
        "status": "completed" if has_success else "failed",
        "rollout_results": rollout_results,
        "execution_log": execution_log,
        "current_node": "rollout_agent"
    }

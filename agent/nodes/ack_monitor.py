import time
from agent.state import AgentState
from agent.tools.opamp_tools import check_agent_ack

def run(state: AgentState) -> dict:
    rollout_results = state.get("rollout_results", [])
    user_id = state.get("user_id")
    
    ack_results = []
    execution_log = []
    
    # We only poll for agents that had a successful push attempt
    successful_agents = [res["agent"] for res in rollout_results if res.get("status") == "success"]
    
    if not successful_agents:
        return {
            "current_node": "ack_monitor",
            "execution_log": ["[AckMonitor] No successful pushes to monitor."]
        }
        
    for agent_name in successful_agents:
        start_time = time.time()
        timeout = 10.0
        sleep_interval = 0.2
        acknowledged = False
        
        while time.time() - start_time < timeout:
            try:
                response = check_agent_ack(user_id, agent_name)
                # Assume response contains something like {"acknowledged": true} or returns 200 only when acked
                # Since the prompt says GET /api/opamp/ack/{agent_name}, we'll check if it's considered acknowledged.
                if response.get("status") == "acknowledged" or response.get("acknowledged") == True:
                    latency = round(time.time() - start_time, 2)
                    ack_results.append({"agent": agent_name, "status": "acknowledged", "latency": latency})
                    execution_log.append(f"[AckMonitor] {agent_name} acknowledged in {latency}s")
                    acknowledged = True
                    break
            except Exception:
                # If the endpoint returns 404/error when not acked yet, we just swallow and loop
                pass
            
            time.sleep(sleep_interval)
            
        if not acknowledged:
            ack_results.append({"agent": agent_name, "status": "timeout"})
            execution_log.append(f"[AckMonitor] {agent_name} acknowledgment timed out.")
            
    return {
        "ack_results": ack_results,
        "execution_log": execution_log,
        "current_node": "ack_monitor"
    }

import time
from datetime import datetime
from agent.state import AgentState
from agent.tools.audit_tools import fetch_audit_logs_tool
from agent.tools.opamp_tools import AgentAPIClient

def run(state: AgentState) -> dict:
    intent = state.get("parsed_intent", {})
    action = intent.get("action")
    user_id = state.get("user_id", "admin")
    
    execution_log = []
    
    if action == "FETCH_AUDIT_LOGS":
        execution_log.append("[QueryEngine] Fetching audit logs...")
        filters = intent.get("query_filters", {}) or {}
        limit = filters.get("limit") or 100
        
        try:
            logs = fetch_audit_logs_tool(user_id, limit=limit)
            
            username = filters.get("username")
            log_action = filters.get("action")
            target = filters.get("target")
            start_ts = filters.get("start_timestamp")
            end_ts = filters.get("end_timestamp")
            
            filtered_logs = []
            for log in logs:
                if username and log.get("username") != username:
                    continue
                if log_action and log.get("action") != log_action:
                    continue
                if target and target.lower() not in (log.get("target") or "").lower():
                    continue
                
                log_ts = log.get("timestamp", 0)
                if start_ts and log_ts < start_ts:
                    continue
                if end_ts and log_ts > end_ts:
                    continue
                    
                filtered_logs.append(log)
                
            execution_log.append(f"[QueryEngine] Found {len(filtered_logs)} matching audit logs.")
            
            if not filtered_logs:
                summary = "No audit logs found matching your filters."
            else:
                summary = "Here are the matching audit logs:\n\n"
                summary += "| Timestamp | User | Action | Target | Details |\n"
                summary += "| --- | --- | --- | --- | --- |\n"
                for log in filtered_logs[:15]:
                    t_str = datetime.fromtimestamp(log.get("timestamp")).strftime("%Y-%m-%d %H:%M:%S")
                    summary += f"| {t_str} | {log.get('username')} | {log.get('action')} | {log.get('target') or '-'} | {log.get('details') or '-'} |\n"
                
                if len(filtered_logs) > 15:
                    summary += f"\n*(showing top 15 of {len(filtered_logs)} logs)*"
                    
            return {
                "final_summary": summary,
                "status": "completed",
                "execution_log": execution_log,
                "current_node": "query_node"
            }
        except Exception as e:
            return {
                "error": f"Failed to fetch audit logs: {str(e)}",
                "status": "failed",
                "current_node": "query_node",
                "execution_log": [f"[QueryEngine] Error: {e}"]
            }
            
    elif action == "QUERY_STATUS":
        execution_log.append("[QueryEngine] Querying cluster status...")
        try:
            client = AgentAPIClient(user_id)
            res = client.get("/api/opamp/agents")
            agents = res.json() if res.status_code == 200 else []
            
            from agent.tools.fleet_tools import get_fleets
            fleets = get_fleets(user_id)
            
            summary = f"### System Status Overview\n\n"
            summary += f"- **Total Agents**: {len(agents)}\n"
            summary += f"- **Total Fleets/Groups**: {len(fleets)}\n\n"
            
            if fleets:
                summary += "#### Fleets List:\n"
                for f in fleets:
                    fleet_agents = [a for a in agents if f.get("name") in a.get("groups", [])]
                    summary += f"- **{f.get('name')}**: {len(fleet_agents)} active agents\n"
            
            return {
                "final_summary": summary,
                "status": "completed",
                "execution_log": execution_log,
                "current_node": "query_node"
            }
        except Exception as e:
            return {
                "error": f"Failed to fetch system status: {str(e)}",
                "status": "failed",
                "current_node": "query_node",
                "execution_log": [f"[QueryEngine] Error: {e}"]
            }
            
    return {
        "error": f"Unknown query action: {action}",
        "status": "failed",
        "current_node": "query_node"
    }

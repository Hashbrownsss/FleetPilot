import json
from agent.state import AgentState
from app.services.audit import log_audit
from app.database import SessionLocal
import uuid

def run(state: AgentState) -> dict:
    user_id = state.get("user_id")
    action = "AGENT_EXECUTION"
    parsed_intent = state.get("parsed_intent", {})
    
    details = {
        "fleet_id": state.get("fleet_id"),
        "config_id": state.get("config_id"),
        "config_version": state.get("config_version"),
        "target_agents": parsed_intent.get("target_agents", []),
        "rollout_results": state.get("rollout_results", []),
        "ack_results": state.get("ack_results", []),
        "session_id": state.get("session_id"),
        "status": state.get("status")
    }
    
    db = SessionLocal()
    try:
        log_audit(
            db=db,
            username=user_id,
            action=action,
            target="fleet_management",
            details=json.dumps(details),
            ip_address="internal_agent"
        )
        audit_event_id = f"evt_{uuid.uuid4().hex[:8]}"
        return {
            "audit_event_id": audit_event_id,
            "current_node": "audit_logger"
        }
    except Exception as e:
        return {
            "error": f"Failed to log audit event: {str(e)}",
            "current_node": "audit_logger"
        }
    finally:
        db.close()

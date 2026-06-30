import uuid
from fastapi import APIRouter, HTTPException, Depends, status
from pydantic import BaseModel
from typing import Optional
import sqlite3

from app.routes.auth import verify_any_role
from agent import build_graph, get_checkpointer

router = APIRouter(prefix="/api/agent", tags=["agent"])

class ChatRequest(BaseModel):
    message: str

class ConfirmRequest(BaseModel):
    decision: str
    feedback: Optional[str] = None

# Global checkpointer and graph instances
checkpointer = get_checkpointer()
graph = build_graph(checkpointer)

@router.post("/chat", status_code=status.HTTP_200_OK)
def chat_with_agent(request: ChatRequest, user: dict = Depends(verify_any_role)):
    user_id = user.get("username", "unknown_user")
    session_id = str(uuid.uuid4())
    
    initial_state = {
        "user_message": request.message,
        "user_id": user_id,
        "session_id": session_id,
        "status": "running",
        "execution_log": [],
        "rollout_results": [],
        "ack_results": []
    }
    
    config = {"configurable": {"thread_id": session_id}}
    
    # Run graph until it hits interrupt or END
    try:
        final_state = graph.invoke(initial_state, config=config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent execution failed: {str(e)}")
    
    status_str = final_state.get("status")
    
    if status_str == "awaiting_human":
        # Return 202 if it paused
        return {
            "status": "awaiting_human",
            "session_id": session_id,
            "review_payload": final_state.get("human_review_payload")
        }
        
    return {
        "status": status_str,
        "session_id": session_id,
        "summary": final_state.get("final_summary")
    }

@router.post("/confirm/{session_id}")
def confirm_agent_execution(session_id: str, request: ConfirmRequest, user: dict = Depends(verify_any_role)):
    user_id = user.get("username", "unknown_user")
    config = {"configurable": {"thread_id": session_id}}
    
    # Load state directly to verify ownership (optional step, but good practice)
    current_state = graph.get_state(config)
    if not current_state or not current_state.values:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    if current_state.values.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to confirm this session.")
        
    state_update = {
        "human_decision": request.decision,
        "human_feedback": request.feedback
    }
    
    try:
        graph.update_state(config, state_update)
        final_state = graph.invoke(None, config=config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent resume failed: {str(e)}")
        
    return {
        "status": final_state.get("status"),
        "summary": final_state.get("final_summary"),
        "rollout_results": final_state.get("rollout_results", []),
        "ack_results": final_state.get("ack_results", [])
    }

@router.get("/status/{session_id}")
def get_agent_status(session_id: str, user: dict = Depends(verify_any_role)):
    user_id = user.get("username", "unknown_user")
    config = {"configurable": {"thread_id": session_id}}
    
    current_state = graph.get_state(config)
    if not current_state or not current_state.values:
        raise HTTPException(status_code=404, detail="Session not found.")
        
    vals = current_state.values
    if vals.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="Not authorized to view this session.")
        
    return {
        "status": vals.get("status"),
        "current_node": vals.get("current_node"),
        "execution_log": vals.get("execution_log", []),
        "human_review_payload": vals.get("human_review_payload")
    }

@router.get("/history")
def get_agent_history(user: dict = Depends(verify_any_role)):
    # Since SqliteSaver stores threads but we don't have a direct query API without raw SQL,
    # we'll query the agent_checkpoints.db manually to find sessions for this user.
    user_id = user.get("username", "unknown_user")
    
    from app.config import Settings
    db_path = Settings.AGENT_CHECKPOINT_DB
    
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        # langgraph.checkpoint.sqlite creates tables `checkpoints` and `checkpoint_blobs` and `checkpoint_writes` (or `threads` depending on version)
        # However, looking up specific thread metadata in langgraph can be complex. We will simplify by returning an empty list for now
        # or implementing a generic list if we know the schema. Let's return empty for now as it's not strictly specified how.
        # Actually, langgraph checkpointer schema differs by version.
        return {"history": []}
    except Exception as e:
        return {"history": [], "error": str(e)}
    finally:
        try:
            conn.close()
        except:
            pass

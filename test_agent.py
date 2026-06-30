import asyncio
from agent.graph import build_graph
from agent.checkpointer import get_checkpointer

def main():
    checkpointer = get_checkpointer()
    graph = build_graph(checkpointer)
    
    session_id = "test-session-123"
    config = {"configurable": {"thread_id": session_id}}
    
    initial_state = {
        "user_message": "create new config version in webservers, all metrics except memory metrics",
        "user_id": "admin",
        "session_id": session_id,
        "status": "running",
        "execution_log": [],
        "rollout_results": [],
        "ack_results": []
    }
    
    try:
        final_state = graph.invoke(initial_state, config=config)
        print("Final Status:", final_state.get("status"))
        print("Execution Log:", final_state.get("execution_log"))
        print("Review Payload:", final_state.get("human_review_payload"))
        print("Error:", final_state.get("error"))
    except Exception as e:
        print("Graph execution threw an exception:", e)

if __name__ == "__main__":
    main()

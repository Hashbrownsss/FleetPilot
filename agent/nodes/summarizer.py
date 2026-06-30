from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from app.config import Settings
from agent.state import AgentState
import json

def run(state: AgentState) -> dict:
    llm = ChatGroq(
        model=Settings.AGENT_MODEL,
        groq_api_key=Settings.GROQ_API_KEY,
        temperature=0.4
    )

    execution_log = state.get("execution_log", [])
    rollout_results = state.get("rollout_results", [])
    ack_results = state.get("ack_results", [])
    intent = state.get("parsed_intent", {})
    
    summary_context = {
        "intent": intent,
        "fleet_name": state.get("fleet_name"),
        "config_profile": intent.get("config_profile"),
        "rollout_results": rollout_results,
        "ack_results": ack_results,
        "execution_log": execution_log
    }

    system_prompt = """You are a helpful AIOps agent. Your job is to summarize the actions you just took for the user.
You will be provided with a JSON context of what happened.
Write a concise, friendly natural language summary (2-4 sentences max).
Example format: "Done — I created fleet test-fleet-4 with a host-metrics-only config (network metrics disabled). The config was pushed to all 3 agents: physical-agent-01 acknowledged in 0.9s, db-node-01 in 1.1s. Everything looks healthy."
Do not include any raw JSON or markdown code blocks in your response. Just the summary string.
"""

    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=json.dumps(summary_context, indent=2))
        ]
        response = llm.invoke(messages)
        
        content = response.content
        if isinstance(content, list):
            final_summary = ""
            for block in content:
                if isinstance(block, str):
                    final_summary += block
                elif isinstance(block, dict) and block.get("type") == "text":
                    final_summary += block.get("text", "")
                elif hasattr(block, "text"):
                    final_summary += getattr(block, "text")
        else:
            final_summary = str(content)
            
        final_summary = final_summary.strip()
        
        return {
            "final_summary": final_summary,
            "status": "completed",
            "current_node": "summarizer"
        }
    except Exception as e:
        return {
            "final_summary": f"Execution completed, but I couldn't generate a friendly summary. Raw results: Rollout: {len(rollout_results)} agents, Acks: {len(ack_results)} agents.",
            "status": "completed",
            "current_node": "summarizer"
        }

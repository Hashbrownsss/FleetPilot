import json
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from app.config import Settings
from agent.state import AgentState

import time
from datetime import datetime

def run(state: AgentState) -> dict:
    llm = ChatGroq(
        model=Settings.AGENT_MODEL,
        groq_api_key=Settings.GROQ_API_KEY,
        temperature=0.0
    )

    current_unix = time.time()
    current_date = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    system_prompt = f"""You are the orchestration brain of an AIOps Fleet Management platform. Your job is to extract the user's intent into a structured JSON payload.

The current date and time is {current_date} and the current Unix timestamp is {current_unix}. 
If the user asks for logs in a specific date or time range (e.g., "last 2 days", "for 6/29/2026"), calculate the appropriate `start_timestamp` and `end_timestamp` (in seconds) and include them in `query_filters`. If they only ask for a specific day, set `start_timestamp` to the start of that day and `end_timestamp` to the end of that day.

You must support the following actions:
1. "CREATE_FLEET_AND_ROLLOUT": User wants to create a new fleet, generate a config, and push/rollout it to agents. Requires: fleet_name.
2. "ROLLOUT_EXISTING_CONFIG": User wants to push/rollout a config (newly generated or existing version) to agents. Requires: fleet_name or target_agents.
3. "CREATE_CONFIG_ONLY": User wants to create/generate a config but not push it yet.
4. "CREATE_FLEET_ONLY": User wants to create a new fleet/group, but does NOT want to generate or rollout any configuration template. Requires: fleet_name.
5. "ASSIGN_AGENTS_TO_FLEET": User wants to move or assign existing agents to a specific fleet. Requires: fleet_name and target_agents.
6. "FETCH_AUDIT_LOGS": User wants to query or view the audit log history/trail.
7. "QUERY_STATUS": User asks about the status of agents, fleets, or general platform metrics.
8. "UNKNOWN": If the user's request is ambiguous or doesn't map to a clear action.

Return ONLY a raw JSON object with no markdown formatting. It must match this schema:
{{
  "action": "CREATE_FLEET_AND_ROLLOUT | ROLLOUT_EXISTING_CONFIG | CREATE_CONFIG_ONLY | CREATE_FLEET_ONLY | ASSIGN_AGENTS_TO_FLEET | FETCH_AUDIT_LOGS | QUERY_STATUS | UNKNOWN", 
  "fleet_name": "string or null",
  "target_agents": ["list", "of", "strings"],
  "disabled_metrics": ["list", "of", "strings", "e.g.", "cpu", "memory", "disk", "network"],
  "config_profile": "baseline_default | host_metrics_only | full_metrics | custom",
  "requires_new_fleet": true/false,
  "requires_new_config": true/false,
  "query_filters": {{
    "username": "string or null",
    "action": "string or null",
    "target": "string or null",
    "start_timestamp": "float or null (Unix epoch time in seconds)",
    "end_timestamp": "float or null (Unix epoch time in seconds)",
    "limit": 100
  }},
  "needs_clarification": true/false,
  "clarification_question": "string or null - fill this if needs_clarification is true"
}}

If the user is asking to do something but missing required fields (like target agents for a rollout, or fleet name for a new fleet), set "needs_clarification": true, "action": "UNKNOWN", and provide a "clarification_question".
"""

    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=state.get("user_message", ""))
        ]
        response = llm.invoke(messages)
        
        # Parse the JSON response
        content = response.content
        if isinstance(content, list):
            text = ""
            for block in content:
                if isinstance(block, str):
                    text += block
                elif isinstance(block, dict) and block.get("type") == "text":
                    text += block.get("text", "")
                elif hasattr(block, "text"):
                    text += getattr(block, "text")
        else:
            text = str(content)
            
        text = text.strip()
        if text.startswith("```json"):
            text = text[7:-3].strip()
        elif text.startswith("```"):
            text = text[3:-3].strip()
            
        parsed_intent = json.loads(text)
        
        # Basic validation
        if "action" not in parsed_intent:
            raise ValueError("Missing 'action' field in parsed intent")
            
        return {
            "parsed_intent": parsed_intent,
            "execution_log": [f"[Orchestrator] Parsed intent: {parsed_intent.get('action')}"],
            "current_node": "orchestrator"
        }
    except Exception as e:
        return {
            "error": f"Failed to parse user intent: {str(e)}",
            "status": "failed",
            "current_node": "orchestrator"
        }

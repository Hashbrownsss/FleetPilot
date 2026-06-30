import yaml
import copy
import re
from agent.state import AgentState
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from app.config import Settings

BASELINE_CONFIG_TEMPLATE = {
    "receivers": {
        "hostmetrics": {
            "collection_interval": "10s",
            "scrapers": {
                "cpu": {},
                "memory": {},
                "disk": {},
                "network": {}
            }
        },
        "otlp": {
            "protocols": {
                "grpc": {},
                "http": {}
            }
        }
    },
    "processors": {
        "batch": {}
    },
    "exporters": {
        "logging": {"verbosity": "detailed"}
    },
    "service": {
        "pipelines": {
            "metrics": {
                "receivers": ["hostmetrics"],
                "processors": ["batch"],
                "exporters": ["logging"]
            },
            "traces": {
                "receivers": ["otlp"],
                "processors": ["batch"],
                "exporters": ["logging"]
            }
        }
    }
}

def get_base_config_yaml(user_id: str, fleet_name: str, user_message: str) -> str:
    version_match = re.search(r'(?:version|v|revision|rev)\s*[:\-#]?\s*(\d+)', user_message, re.IGNORECASE)
    if not version_match:
        return None
        
    version_num = int(version_match.group(1))
    
    try:
        from agent.tools.api_client import AgentAPIClient
        client = AgentAPIClient(user_id)
        
        res = client.get("/api/configurations")
        configs = res.json() if res.status_code == 200 else []
        
        matched_config = None
        norm_fleet = fleet_name.lower().replace(" ", "").replace("-", "").replace("_", "") if fleet_name else ""
        
        for c in configs:
            c_name = c.get("name", "")
            norm_c = c_name.lower().replace(" ", "").replace("-", "").replace("_", "")
            if norm_fleet == norm_c:
                matched_config = c_name
                break
                
        if not matched_config:
            matched_config = fleet_name
            
        if matched_config:
            response = client.get(f"/api/configurations/{matched_config}/versions")
            if response.status_code == 200:
                revisions = response.json().get("revisions", [])
                for rev in revisions:
                    if rev.get("version") == version_num:
                        return rev.get("config")
    except Exception as e:
        print(f"Error fetching base configuration version: {e}")
        
    return None


def resolve_fleet_and_agents(user_id: str, parsed_intent: dict) -> tuple:
    target_agents = parsed_intent.get("target_agents", [])
    fleet_name = parsed_intent.get("fleet_name")
    
    if target_agents:
        return fleet_name, target_agents
        
    if not fleet_name:
        return fleet_name, []
        
    try:
        from agent.tools.fleet_tools import get_fleets
        from agent.tools.api_client import AgentAPIClient
        
        fleets = get_fleets(user_id)
        matched_fleet = fleet_name
        
        norm_fleet_name = fleet_name.lower().replace(" ", "").replace("-", "").replace("_", "")
        for f in fleets:
            f_name = f.get("name", "")
            norm_f = f_name.lower().replace(" ", "").replace("-", "").replace("_", "")
            if norm_fleet_name == norm_f:
                matched_fleet = f_name
                break
                
        client = AgentAPIClient(user_id)
        response = client.get(f"/api/opamp/agents?group={matched_fleet}")
        if response.status_code == 200:
            agents_data = response.json()
            resolved_agents = [a.get("name") for a in agents_data if a.get("name")]
            return matched_fleet, resolved_agents
            
    except Exception as e:
        print(f"Error resolving fleet agents: {e}")
        
    return fleet_name, []

def run(state: AgentState) -> dict:
    parsed_intent = state.get("parsed_intent", {})
    user_id = state.get("user_id", "admin")
    
    # Resolve targets and fuzzy-match fleet name
    matched_fleet, resolved_agents = resolve_fleet_and_agents(user_id, parsed_intent)
    
    updated_intent = copy.deepcopy(parsed_intent)
    updated_intent["target_agents"] = resolved_agents
    updated_intent["fleet_name"] = matched_fleet
    
    base_yaml = get_base_config_yaml(user_id, matched_fleet, state.get("user_message", ""))
    
    if not base_yaml:
        base_yaml = yaml.dump(BASELINE_CONFIG_TEMPLATE, sort_keys=False)
        
    system_prompt = """You are an expert AIOps config builder. Your job is to generate or modify OpenTelemetry (OTel) Collector configurations in YAML format based on the user's instructions.

You will be provided with:
1. The base OTel configuration YAML (or the default baseline template if none is specified).
2. The user's query/instruction.

Your task is to output ONLY the valid, syntactically correct modified OTel collector configuration YAML. Do not wrap the YAML in markdown code blocks (i.e. do not use ```yaml). Just output the raw YAML string.

Rules:
- If the instruction requires disabling certain scrapers under 'hostmetrics' (like memory, network, etc.), make sure they are removed from the receivers section or updated accordingly.
- Keep the overall OTel format: receivers, processors, exporters, and service pipelines.
- Ensure all YAML spacing and structures are valid.
"""
    
    prompt = f"""Base Configuration:
{base_yaml}

User Message / Instruction:
{state.get("user_message")}

Extracted intent context:
- Config profile: {parsed_intent.get("config_profile")}
- Disabled metrics: {parsed_intent.get("disabled_metrics")}
"""
    
    llm = ChatGroq(
        model=Settings.AGENT_MODEL,
        groq_api_key=Settings.GROQ_API_KEY,
        temperature=0.0
    )
    
    execution_log = []
    try:
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=prompt)
        ]
        response = llm.invoke(messages)
        generated_yaml = response.content.strip()
        
        if generated_yaml.startswith("```yaml"):
            generated_yaml = generated_yaml[7:-3].strip()
        elif generated_yaml.startswith("```"):
            generated_yaml = generated_yaml[3:-3].strip()
            
        execution_log.append(f"[ConfigBuilder] Successfully generated YAML using LLM ({len(generated_yaml)} bytes)")
    except Exception as e:
        generated_yaml = base_yaml
        execution_log.append(f"[ConfigBuilder] LLM generation failed, fallback to base config: {e}")
        
    if resolved_agents:
        execution_log.append(f"[ConfigBuilder] Automatically targeted {len(resolved_agents)} agents in fleet '{matched_fleet}'")
        
    return {
        "generated_yaml": generated_yaml,
        "config_version": "v1.0.0",
        "parsed_intent": updated_intent,
        "fleet_name": matched_fleet,
        "execution_log": execution_log,
        "current_node": "config_builder"
    }

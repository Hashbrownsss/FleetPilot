from agent.tools.api_client import AgentAPIClient

def push_config_to_agent(username: str, agent_name: str, config_id: str) -> dict:
    client = AgentAPIClient(username)
    response = client.post("/api/opamp/push", json={"agent_name": agent_name, "config_id": config_id})
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Failed to push config to agent {agent_name}: {response.text}")
        
def check_agent_ack(username: str, agent_name: str) -> dict:
    client = AgentAPIClient(username)
    response = client.get(f"/api/opamp/ack/{agent_name}")
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Failed to get ack from agent {agent_name}: {response.text}")

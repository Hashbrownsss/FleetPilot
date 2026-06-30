from agent.tools.api_client import AgentAPIClient

def create_configuration(username: str, name: str, description: str, yaml_content: str, fleet_id: str = None) -> dict:
    client = AgentAPIClient(username)
    payload = {
        "name": name,
        "description": description,
        "config": yaml_content
    }
    if fleet_id:
        payload["fleet_id"] = fleet_id
        
    response = client.post("/api/configurations", json=payload)
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Failed to create configuration: {response.text}")

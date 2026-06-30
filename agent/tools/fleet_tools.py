from agent.tools.api_client import AgentAPIClient

def create_fleet(username: str, fleet_name: str) -> dict:
    client = AgentAPIClient(username)
    response = client.post("/api/fleets", json={"name": fleet_name, "description": "Created by Agent"})
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Failed to create fleet: {response.text}")

def get_fleets(username: str) -> list:
    client = AgentAPIClient(username)
    response = client.get("/api/fleets")
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Failed to fetch fleets: {response.text}")

def assign_agents_to_fleet(username: str, fleet_name: str, agent_ids: list) -> dict:
    client = AgentAPIClient(username)
    response = client.post(f"/api/fleets/{fleet_name}/assign_agents", json={"agent_ids": agent_ids})
    if response.status_code == 200:
        return response.json()
    else:
        raise Exception(f"Failed to assign agents to fleet: {response.text}")

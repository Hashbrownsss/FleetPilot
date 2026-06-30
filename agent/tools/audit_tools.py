from agent.tools.api_client import AgentAPIClient
from datetime import datetime
import time

def fetch_audit_logs_tool(username: str, limit: int = 100) -> list:
    client = AgentAPIClient(username)
    response = client.get(f"/api/audit?limit={limit}")
    if response.status_code == 200:
        return response.json().get("logs", [])
    else:
        raise Exception(f"Failed to fetch audit logs: {response.text}")

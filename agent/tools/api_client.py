import requests
from app.config import Settings
from app.routes.auth import create_local_jwt

class AgentAPIClient:
    def __init__(self, username: str):
        self.base_url = Settings.BACKEND_BASE_URL
        self.username = username
        # Generate an admin token for the agent actions
        self.token = create_local_jwt(username, "admin")
        self.headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }

    def post(self, endpoint: str, json: dict = None):
        url = f"{self.base_url}{endpoint}"
        return requests.post(url, json=json, headers=self.headers, timeout=5.0)

    def get(self, endpoint: str):
        url = f"{self.base_url}{endpoint}"
        return requests.get(url, headers=self.headers, timeout=5.0)

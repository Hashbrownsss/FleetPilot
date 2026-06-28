import requests
import time
import os
import json

BASE_URL = "http://localhost:8000"

def run_fleet_tests():
    print("=== STARTING OTEL AGENT FLEET CONTROL PLANE FEATURE TESTS ===")

    # 1. Login as Admin & User
    print("\n--- Authentication Setup ---")
    login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    })
    assert login_res.status_code == 200, "Admin login failed"
    admin_token = login_res.json().get("token")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    print("Admin logged in successfully.")

    login_res_u = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": "user",
        "password": "user123"
    })
    assert login_res_u.status_code == 200, "User login failed"
    user_token = login_res_u.json().get("token")
    user_headers = {"Authorization": f"Bearer {user_token}"}
    print("User logged in successfully.")

    # 2. RBAC Guards Validation
    print("\n--- Test 1: RBAC Guard Enforcement ---")
    
    test_config = """receivers:
  hostmetrics:
    collection_interval: 10s
processors:
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: []
      exporters: [otlp]"""

    # User trying to deploy config -> should be 403
    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/config",
        headers=user_headers,
        json={"config": test_config}
    )
    print(f"User deploy config: status={res.status_code}, response={res.text}")
    assert res.status_code == 403, "Expected 403 Forbidden for User deploy config"
    print("RBAC Guard: Blocked standard user config deployment.")

    # User trying to rollback config -> should be 403
    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/rollback",
        headers=user_headers,
        json={"revision": 1}
    )
    print(f"User rollback config: status={res.status_code}, response={res.text}")
    assert res.status_code == 403, "Expected 403 Forbidden for User rollback"
    print("RBAC Guard: Blocked standard user rollback.")

    # User trying to change group -> should be 403
    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/group",
        headers=user_headers,
        json={"groups": ["Default"]}
    )
    print(f"User group change: status={res.status_code}, response={res.text}")
    assert res.status_code == 403, "Expected 403 Forbidden for User group change"
    print("RBAC Guard: Blocked standard user group change.")

    # 3. Config Lineage & History Logging (Admin)
    print("\n--- Test 2: Admin Config Deployment & History Logging ---")
    
    config_v1 = """receivers:
  hostmetrics:
    collection_interval: 10s
processors:
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: []
      exporters: [otlp]"""

    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/config",
        headers=admin_headers,
        json={"config": config_v1}
    )
    print(f"Admin deploy config V1: status={res.status_code}")
    assert res.status_code == 200, "Admin failed to deploy config V1"

    # Query config history
    history_res = requests.get(
        f"{BASE_URL}/api/opamp/config_history/virtual-db-node-01",
        headers=admin_headers
    )
    assert history_res.status_code == 200, "Failed to get config history"
    history = history_res.json()
    print(f"Current Config History length: {len(history)}")
    assert len(history) >= 1, "Config history is empty"
    
    # Get last revision ID
    rev_v1 = history[-1]["revision"]
    print(f"Registered Revision V1 ID: {rev_v1}")

    # Deploy config v2
    config_v2 = """receivers:
  hostmetrics:
    collection_interval: 6s
processors:
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: []
      exporters: [otlp]"""

    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/config",
        headers=admin_headers,
        json={"config": config_v2}
    )
    print(f"Admin deploy config V2: status={res.status_code}")
    assert res.status_code == 200, "Admin failed to deploy config V2"

    history_res2 = requests.get(
        f"{BASE_URL}/api/opamp/config_history/virtual-db-node-01",
        headers=admin_headers
    )
    history2 = history_res2.json()
    assert len(history2) == len(history) + 1, "History not incremented"
    rev_v2 = history2[-1]["revision"]
    print(f"Registered Revision V2 ID: {rev_v2}")

    # 4. Rollbacks Propagation
    print("\n--- Test 3: One-Click Rollbacks ---")
    
    # Rollback to revision v1
    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/rollback",
        headers=admin_headers,
        json={"revision": rev_v1}
    )
    print(f"Admin rollback to V1: status={res.status_code}")
    assert res.status_code == 200, "Admin failed to rollback config"

    # Query agent details and assert custom_config matches config_v1
    details_res = requests.get(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01",
        headers=admin_headers
    )
    assert details_res.status_code == 200
    details = details_res.json()
    custom_config = details.get("custom_config", "")
    print("Verifying rollback config content...")
    assert "collection_interval: 10s" in custom_config, "Custom config did not roll back to V1"
    print("Rollback verify: Custom config successfully restored to V1.")

    # 5. ServiceNow Incident Creation
    print("\n--- Test 4: ServiceNow Incident Integration ---")
    
    # Clean up incidents file first if it exists to make assertions clean
    incidents_file = "servicenow_incidents.json"
    if os.path.exists(incidents_file):
        try:
            os.remove(incidents_file)
            print("Cleared existing mock incidents file.")
        except Exception as e:
            print(f"Failed to remove incidents file: {e}")

    # Update virtual-web-node-01 (PROD) to Offline
    print("Setting virtual-web-node-01 to Offline...")
    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-web-node-01/status",
        headers=admin_headers,
        json={"status": "Offline"}
    )
    assert res.status_code == 200

    # Update virtual-db-node-01 (DEV) to Warning
    print("Setting virtual-db-node-01 to Warning...")
    res = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/status",
        headers=admin_headers,
        json={"status": "Warning"}
    )
    assert res.status_code == 200

    print("Waiting 12 seconds for ServiceNow sync loop thread to check statuses...")
    time.sleep(12)

    # Check incidents API
    incidents_res = requests.get(
        f"{BASE_URL}/api/opamp/incidents",
        headers=admin_headers
    )
    assert incidents_res.status_code == 200
    incidents = incidents_res.json()
    print(f"Generated ServiceNow incidents count: {len(incidents)}")
    assert len(incidents) >= 2, "Expected at least 2 incidents generated"

    prod_incident = None
    dev_incident = None
    for inc in incidents:
        if inc.get("agent_id") == "virtual-web-node-01":
            prod_incident = inc
        elif inc.get("agent_id") == "virtual-db-node-01":
            dev_incident = inc

    assert prod_incident is not None, "Missing incident for PROD agent virtual-web-node-01"
    assert dev_incident is not None, "Missing incident for DEV agent virtual-db-node-01"

    print(f"PROD Incident: ID={prod_incident.get('incident_id')}, Priority={prod_incident.get('priority')}, Desc={prod_incident.get('description')}")
    print(f"DEV Incident: ID={dev_incident.get('incident_id')}, Priority={dev_incident.get('priority')}, Desc={dev_incident.get('description')}")

    assert prod_incident.get("priority") == "P1 - Critical", "PROD agent incident must be P1 - Critical"
    assert dev_incident.get("priority") == "P3 - Moderate", "DEV agent incident must be P3 - Moderate"
    print("ServiceNow Incident Verification Passed: Correct prioritization rules applied.")

    # Reset statuses to Healthy
    print("\nCleaning up: Restoring agent statuses to Healthy...")
    requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-web-node-01/status",
        headers=admin_headers,
        json={"status": "Healthy"}
    )
    requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/status",
        headers=admin_headers,
        json={"status": "Healthy"}
    )

    print("\n=== ALL FLEET CONTROL PLANE FEATURE TESTS PASSED ===")

if __name__ == "__main__":
    run_fleet_tests()

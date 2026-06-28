import requests
import time

BASE_URL = "http://localhost:8000"

def run_guard_tests():
    print("=== STARTING DEPLOYMENT PHASE & OS PLATFORM COMPATIBILITY GUARD TESTS ===")

    # 1. Login as Admin
    login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    })
    admin_auth = login_res.json()
    admin_headers = {"Authorization": f"Bearer {admin_auth.get('token')}"}
    print("Logged in as Admin.")

    # 2. Test OS Compatibility: Deploy windowsperfcounters to virtual-db-node-01 (Linux, dev)
    # Target agent is Linux, config has windowsperfcounters -> Should fail
    win_counters_config = """receivers:
  windowsperfcounters:
    collection_interval: 10s
processors:
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [windowsperfcounters]
      processors: []
      exporters: [otlp]"""
      
    print("\n--- Test A: Deploy Windows counter to Linux node ---")
    res_a = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-db-node-01/config",
        headers=admin_headers,
        json={"config": win_counters_config}
    )
    print(f"Status Code = {res_a.status_code}")
    print(f"Response: {res_a.json()}")
    assert res_a.status_code == 400
    assert "OS Compatibility Guard" in res_a.json().get("detail", "")
    print("Test A Passed: Correctly blocked Windows component on Linux.")

    # 3. Test OS Compatibility: Deploy journald to physical-agent-01 (Windows, prod)
    # Target agent is Windows, config has journald -> Should fail
    journald_config = """receivers:
  journald:
    collection_interval: 10s
processors:
exporters:
  otlp:
    endpoint: "localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [journald]
      processors: []
      exporters: [otlp]"""

    print("\n--- Test B: Deploy Linux-only journald to Windows physical agent ---")
    res_b = requests.post(
        f"{BASE_URL}/api/opamp/agent/019e87db-e86e-7613-b5c7-b10c35cb552c/config",
        headers=admin_headers,
        json={"config": journald_config}
    )
    print(f"Status Code = {res_b.status_code}")
    print(f"Response: {res_b.json()}")
    assert res_b.status_code == 400
    assert "OS Compatibility Guard" in res_b.json().get("detail", "")
    print("Test B Passed: Correctly blocked Linux component on Windows.")

    # 4. Test Deployment Guard: Aggressive collection interval on PROD agent (virtual-web-node-01 is prod)
    # Scrape interval = 2s -> Should fail in prod
    aggressive_config = """receivers:
  hostmetrics:
    collection_interval: 2s
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

    print("\n--- Test C: Deploy aggressive collection interval (<5s) to Production agent ---")
    res_c = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-web-node-01/config",
        headers=admin_headers,
        json={"config": aggressive_config}
    )
    print(f"Status Code = {res_c.status_code}")
    print(f"Response: {res_c.json()}")
    assert res_c.status_code == 400
    assert "Deployment Guard" in res_c.json().get("detail", "")
    print("Test C Passed: Correctly blocked aggressive collection interval in Production.")

    # 5. Test Deployment Guard: Insecure HTTP external exporter in Production (virtual-web-node-01)
    # Exporter has http://external-server:4317 -> Should fail in prod
    insecure_exporter_config = """receivers:
  hostmetrics:
    collection_interval: 10s
processors:
exporters:
  otlp:
    endpoint: "http://insecure-gateway-host.com:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: []
      exporters: [otlp]"""

    print("\n--- Test D: Deploy insecure external HTTP exporter to Production agent ---")
    res_d = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-web-node-01/config",
        headers=admin_headers,
        json={"config": insecure_exporter_config}
    )
    print(f"Status Code = {res_d.status_code}")
    print(f"Response: {res_d.json()}")
    assert res_d.status_code == 400
    assert "Deployment Guard" in res_d.json().get("detail", "")
    print("Test D Passed: Correctly blocked insecure external URL in Production.")

    # 6. Test Successful Deploy: Conformant config in Production
    conformant_config = """receivers:
  hostmetrics:
    collection_interval: 10s
processors:
exporters:
  otlp:
    endpoint: "http://localhost:4317"
service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: []
      exporters: [otlp]"""

    print("\n--- Test E: Deploy conformant config (interval=10s, local HTTP) to Production agent ---")
    res_e = requests.post(
        f"{BASE_URL}/api/opamp/agent/virtual-web-node-01/config",
        headers=admin_headers,
        json={"config": conformant_config}
    )
    print(f"Status Code = {res_e.status_code}")
    print(f"Response: {res_e.json()}")
    assert res_e.status_code == 200
    print("Test E Passed: Successfully allowed secure/conformant deployment to Production.")

    print("\n=== ALL PLATFORM & DEPLOYMENT PHASE TESTS PASSED ===")

if __name__ == "__main__":
    run_guard_tests()

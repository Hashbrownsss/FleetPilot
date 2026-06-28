import requests
import json

BASE_URL = "http://localhost:8000"

new_default_template = """extensions:
  health_check:
    endpoint: "0.0.0.0:13133"

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: "0.0.0.0:4317"
      http:
        endpoint: "0.0.0.0:4318"
  hostmetrics:
    collection_interval: 10s
    scrapers:
      cpu:
      disk:
      filesystem:
      load:
      memory:
      network:
      paging:
      processes:

processors:
  batch:
    timeout: 10s
    send_batch_size: 1024

exporters:
  debug:
    verbosity: detailed
  prometheus:
    endpoint: "0.0.0.0:8889"
    namespace: otelcol
  kafka:
    protocol_version: "2.0.0"
    brokers: ["kafka:9092"]
    metrics:
      topic: "raw-metrics"
      encoding: otlp_json

service:
  extensions: [health_check]
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    metrics:
      receivers: [otlp, hostmetrics]
      processors: [batch]
      exporters: [debug, kafka, prometheus]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]"""

def main():
    # 1. Update the local group_templates.json file
    print("Reading group_templates.json...")
    try:
        with open("group_templates.json", "r") as f:
            templates = json.load(f)
    except Exception as e:
        print(f"Could not load template file: {e}")
        templates = {}

    templates["Default"] = new_default_template

    with open("group_templates.json", "w") as f:
        json.dump(templates, f, indent=2)
    print("Updated group_templates.json on disk.")

    # 2. Authenticate as Admin
    print("Logging in to AIOps Backend...")
    login_res = requests.post(f"{BASE_URL}/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    })
    
    if login_res.status_code != 200:
        print("Login failed!")
        return

    admin_auth = login_res.json()
    admin_headers = {"Authorization": f"Bearer {admin_auth.get('token')}"}
    print("Login successful.")

    # 3. Propagate the updated template via the API
    print("Propagating template update via API...")
    res = requests.post(
        f"{BASE_URL}/api/opamp/group/Default/template",
        headers=admin_headers,
        json={"template": new_default_template}
    )

    print(f"API Response Status Code: {res.status_code}")
    print(f"API Response: {res.json()}")

if __name__ == "__main__":
    main()

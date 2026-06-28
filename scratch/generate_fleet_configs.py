import os

base_dir = "fleet_agents"

supervisor_template = """server:
  endpoint: wss://opamp-server:4320/v1/opamp
  tls:
    insecure_skip_verify: true
    ca_file: /etc/otel/certs/ca.cert.pem
    cert_file: /etc/otel/certs/agent{index}.crt
    key_file: /etc/otel/certs/agent{index}.key

capabilities:
  reports_effective_config: true
  reports_own_metrics: true
  reports_health: true
  accepts_remote_config: true
  reports_remote_config: true
  accepts_restart_command: true
  reports_available_components: true
  reports_heartbeat: true

agent:
  executable: /otelcontribcol
  bootstrap_timeout: 10s
  passthrough_logs: true
  config_files:
    - /etc/otel/config.yaml

storage:
  directory: /etc/otel/supervisor-data

telemetry:
  logs:
    level: debug
"""

collector_config = """extensions:
  health_check:
    endpoint: 0.0.0.0:13133

receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318
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
    endpoint: 0.0.0.0:8889
    namespace: otelcol
  kafka:
    protocol_version: 2.0.0
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
      exporters: [debug]
"""

def generate_configs():
    print("Generating fleet config files...")
    for i in range(1, 6):
        agent_dir = os.path.join(base_dir, f"agent-{i}")
        
        # Write supervisor.yaml
        supervisor_content = supervisor_template.format(index=i)
        supervisor_path = os.path.join(agent_dir, "supervisor.yaml")
        with open(supervisor_path, "w") as f:
            f.write(supervisor_content)
        print(f"Created {supervisor_path}")

        # Write collector-supervised.yaml
        collector_path = os.path.join(agent_dir, "collector-supervised.yaml")
        with open(collector_path, "w") as f:
            f.write(collector_config)
        print(f"Created {collector_path}")
        
        # Ensure supervisor-data folder exists on host
        data_dir = os.path.join(agent_dir, "supervisor-data")
        os.makedirs(data_dir, exist_ok=True)
        print(f"Created data directory {data_dir}")

    print("All configurations generated successfully!")

if __name__ == "__main__":
    generate_configs()

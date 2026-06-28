import requests
import json
import sys
from kafka import KafkaConsumer

print("=== RUNNING SYSTEM DIAGNOSTICS ===")

# 1. Test FastAPI Backend Connectivity
print("\n[1/4] Checking FastAPI Backend Connectivity...")
try:
    auth_res = requests.post("http://localhost:8000/api/auth/login", json={
        "username": "admin",
        "password": "admin123"
    }, timeout=3.0)
    if auth_res.status_code == 200:
        token = auth_res.json().get("token")
        headers = {"Authorization": f"Bearer {token}"}
        print("  FastAPI backend is online. Admin login succeeded.")
        
        # Check active agents
        agents_res = requests.get("http://localhost:8000/api/opamp/agents", headers=headers, timeout=3.0)
        if agents_res.status_code == 200:
            agents = agents_res.json().get("agents", [])
            print(f"  Backend reports {len(agents)} registered agents:")
            for a in agents:
                print(f"    - ID: {a.get('id')} | Name: {a.get('name')} | Status: {a.get('status')} | OS: {a.get('os')} | Type: {a.get('type')}")
        else:
            print(f"  ERROR fetching agents: status={agents_res.status_code}")
            
        # Check live metrics
        metrics_res = requests.get("http://localhost:8000/api/metrics/live", headers=headers, timeout=3.0)
        if metrics_res.status_code == 200:
            metrics_data = metrics_res.json()
            print(f"  Backend live metrics endpoint returned {len(metrics_data)} data points.")
        else:
            print(f"  ERROR fetching live metrics: status={metrics_res.status_code}")
    else:
        print(f"  FastAPI admin login failed: status={auth_res.status_code}, response={auth_res.text}")
except Exception as e:
    print(f"  CRITICAL: FastAPI backend connection failed: {e}")

# 2. Test Kafka Broker Connectivity
print("\n[2/4] Checking Kafka Broker Connectivity on localhost:9094...")
try:
    consumer = KafkaConsumer(
        bootstrap_servers=['localhost:9094'],
        request_timeout_ms=3000,
        consumer_timeout_ms=3000
    )
    topics = consumer.topics()
    print(f"  Successfully connected to Kafka broker. Available topics: {topics}")
except Exception as e:
    print(f"  CRITICAL: Kafka broker connection failed on localhost:9094: {e}")

# 3. Test Raw Metrics Topic flow
print("\n[3/4] Checking raw-metrics topic stream...")
try:
    consumer = KafkaConsumer(
        'raw-metrics',
        bootstrap_servers=['localhost:9094'],
        auto_offset_reset='earliest',
        consumer_timeout_ms=5000
    )
    print("  Listening to 'raw-metrics' topic for up to 5 seconds...")
    msg_count = 0
    for message in consumer:
        msg_count += 1
        if msg_count == 1:
            print("  Successfully received message from raw-metrics!")
            try:
                val = json.loads(message.value.decode('utf-8'))
                print("  Sample OTLP message structure: ")
                print(json.dumps(val, indent=2)[:300] + " ... [TRUNCATED]")
            except Exception as je:
                print(f"  Could not decode message as JSON: {je}")
        if msg_count >= 5:
            break
    print(f"  Ingested {msg_count} messages from raw-metrics stream.")
    if msg_count == 0:
        print("  WARNING: No messages received in 5 seconds. Metrics are not flowing from collectors.")
except Exception as e:
    print(f"  ERROR listening to raw-metrics: {e}")

print("\n=== SYSTEM DIAGNOSTICS COMPLETED ===")

import os
import json
import time
import threading
from kafka import KafkaConsumer, KafkaProducer
import app.ml
from app.ml import metrics_lock, metrics_history
from app.ml.detector import DiurnalAnomalyDetector
from app.config import settings

# Global Kafka Producer for Alerts
alerts_producer = None

def get_alerts_producer():
    global alerts_producer
    if alerts_producer is None:
        try:
            alerts_producer = KafkaProducer(
                bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS.split(","),
                value_serializer=lambda v: json.dumps(v).encode('utf-8')
            )
            print("ML: Successfully initialized alerts KafkaProducer.")
        except Exception as e:
            print(f"ML: Failed to initialize alerts KafkaProducer: {e}")
    return alerts_producer

# Latest metric state cache
current_metric_state = {
    "cpu": 0.05,
    "memory": 35.0,
    "disk_read": 0.02,
    "disk_write": 0.02,
    "net_recv": 0.01,
    "net_sent": 0.01,
    "processes": 4.0
}

# Cumulative counters rate-diffing state
last_raw_values = {}
last_raw_time = {}

def calculate_rate(name, current_val, now, agent_id="unknown"):
    """Converts a cumulative counter to a rate (per second)."""
    if current_val is None:
        return 0.0
    
    key = f"{agent_id}_{name}"
    if key not in last_raw_values:
        last_raw_values[key] = current_val
        last_raw_time[key] = now
        return 0.01
    
    dt = now - last_raw_time[key]
    diff = current_val - last_raw_values[key]
    
    if diff < 0:
        diff = 0.0
        
    rate = 0.0
    if dt > 0:
        rate = diff / dt
        
    last_raw_values[key] = current_val
    last_raw_time[key] = now
    
    return max(0.0, rate)

# ----------------------------------------------------
# OTLP Kafka Stream Parser
# ----------------------------------------------------
def parse_otlp_metrics(raw_bytes, now):
    try:
        payload = json.loads(raw_bytes.decode('utf-8'))
        
        # Extract service instance ID
        instance_id = "unknown"
        resource_metrics = payload.get("resourceMetrics", [])
        for rm in resource_metrics:
            resource = rm.get("resource", {})
            attributes = resource.get("attributes", [])
            for attr in attributes:
                if attr.get("key") in ("service.instance.id", "service.id"):
                    instance_id = attr.get("value", {}).get("stringValue", "unknown")
                    break
                elif attr.get("key") == "host.name":
                    instance_id = attr.get("value", {}).get("stringValue", "unknown")
            if instance_id != "unknown":
                break
        
        cpu = None
        cpu_time_raw = {}
        mem_used = None
        mem_total = 0
        disk_read_raw = None
        disk_write_raw = None
        net_recv_raw = None
        net_sent_raw = None
        processes = None
        
        for rm in resource_metrics:
            for sm in rm.get("scopeMetrics", []):
                for m in sm.get("metrics", []):
                    name = m.get("name")
                    
                    if name == "system.cpu.load_average.1m":
                        dp = m.get("gauge", {}).get("dataPoints", [])
                        if dp:
                            cpu = float(dp[0].get("asDouble", 0.0))
                            
                    elif name == "system.cpu.time":
                        dp_list = m.get("sum", {}).get("dataPoints", [])
                        for dp in dp_list:
                            state = ""
                            for attr in dp.get("attributes", []):
                                if attr.get("key") == "state":
                                    state = attr.get("value", {}).get("stringValue", "")
                            val = float(dp.get("asDouble", 0.0))
                            cpu_time_raw[state] = cpu_time_raw.get(state, 0.0) + val
                            
                    elif name == "system.memory.usage":
                        dp_list = m.get("sum", {}).get("dataPoints", [])
                        for dp in dp_list:
                            state = ""
                            for attr in dp.get("attributes", []):
                                if attr.get("key") == "state":
                                    state = attr.get("value", {}).get("stringValue", "")
                            
                            val = float(dp.get("asInt", 0.0))
                            if state == "used":
                                mem_used = val
                            mem_total += val
                            
                    elif name == "system.disk.io":
                        dp_list = m.get("sum", {}).get("dataPoints", [])
                        for dp in dp_list:
                            direction = ""
                            for attr in dp.get("attributes", []):
                                if attr.get("key") == "direction":
                                    direction = attr.get("value", {}).get("stringValue", "")
                            
                            val = float(dp.get("asInt", 0.0))
                            if direction == "read":
                                disk_read_raw = val
                            elif direction == "write":
                                disk_write_raw = val
                                
                    elif name == "system.network.io":
                        dp_list = m.get("sum", {}).get("dataPoints", [])
                        for dp in dp_list:
                            direction = ""
                            for attr in dp.get("attributes", []):
                                if attr.get("key") == "direction":
                                    direction = attr.get("value", {}).get("stringValue", "")
                            
                            val = float(dp.get("asInt", 0.0))
                            if direction == "receive":
                                net_recv_raw = val
                            elif direction == "transmit":
                                net_sent_raw = val
                                
                    elif name == "system.processes.count":
                        dp_list = m.get("sum", {}).get("dataPoints", [])
                        if dp_list:
                            processes = sum(float(dp.get("asInt", 0.0)) for dp in dp_list)
                            
        # Convert cumulative CPU time to utilization percentage (fraction)
        cpu_util = None
        if cpu_time_raw:
            idle = cpu_time_raw.get("idle", 0.0)
            total = sum(cpu_time_raw.values())
            
            idle_key = f"{instance_id}_cpu_idle"
            total_key = f"{instance_id}_cpu_total"
            
            prev_idle = last_raw_values.get(idle_key)
            prev_total = last_raw_values.get(total_key)
            
            if prev_idle is not None and prev_total is not None:
                diff_idle = idle - prev_idle
                diff_total = total - prev_total
                if diff_total > 0:
                    cpu_util = 1.0 - (diff_idle / diff_total)
                    cpu_util = max(0.0, min(1.0, cpu_util))
            
            last_raw_values[idle_key] = idle
            last_raw_values[total_key] = total
            
        if cpu is None and cpu_util is not None:
            cpu = cpu_util
  
        # Convert cumulative bytes to MB/s rate
        disk_read = None
        disk_write = None
        net_recv = None
        net_sent = None
        
        if disk_read_raw is not None:
            disk_read = calculate_rate("disk_read", disk_read_raw, now, instance_id) / (1024 * 1024)
        if disk_write_raw is not None:
            disk_write = calculate_rate("disk_write", disk_write_raw, now, instance_id) / (1024 * 1024)
        if net_recv_raw is not None:
            net_recv = calculate_rate("net_recv", net_recv_raw, now, instance_id) / (1024 * 1024)
        if net_sent_raw is not None:
            net_sent = calculate_rate("net_sent", net_sent_raw, now, instance_id) / (1024 * 1024)
            
        mem = (mem_used / mem_total * 100.0) if (mem_used is not None and mem_total > 0) else None
        
        return {
            "agent_id": instance_id,
            "timestamp": now,
            "cpu": cpu,
            "memory": mem,
            "disk_read": disk_read,
            "disk_write": disk_write,
            "net_recv": net_recv,
            "net_sent": net_sent,
            "processes": processes
        }
    except Exception as e:
        print(f"ML: Metric parsing error: {e}")
        return {}

def run_ml_consumer_loop():
    if app.ml.detector is None:
        app.ml.detector = DiurnalAnomalyDetector()
    
    print("ML: Connecting to Kafka raw-metrics...")
    try:
        consumer = KafkaConsumer(
            'raw-metrics',
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS.split(","),
            group_id="aiops-ml-raw-metrics-group",
            auto_offset_reset='latest'
        )
        print("ML: Listening to metrics stream...")
    except Exception as e:
        print(f"ML: Kafka Connection Error: {e}")
        return

    # Cache for agent metrics: agent_id -> parsed_metrics
    agent_metrics_cache = {}
    last_agg_time = time.time()

    try:
        for message in consumer:
            now = time.time()
            parsed = parse_otlp_metrics(message.value, now)
            if not parsed:
                continue
                
            agent_id = parsed.get("agent_id", "unknown")
            agent_metrics_cache[agent_id] = parsed
            
            # Periodically aggregate and process metrics (every 5 seconds)
            if now - last_agg_time >= 5.0:
                active_agents = [
                    v for v in agent_metrics_cache.values()
                    if now - v.get("timestamp", 0) <= 20.0
                ]
                
                if active_agents:
                    valid_cpus = [a["cpu"] for a in active_agents if a.get("cpu") is not None]
                    valid_mems = [a["memory"] for a in active_agents if a.get("memory") is not None]
                    valid_disk_reads = [a["disk_read"] for a in active_agents if a.get("disk_read") is not None]
                    valid_disk_writes = [a["disk_write"] for a in active_agents if a.get("disk_write") is not None]
                    valid_net_recvs = [a["net_recv"] for a in active_agents if a.get("net_recv") is not None]
                    valid_net_sents = [a["net_sent"] for a in active_agents if a.get("net_sent") is not None]
                    valid_procs = [a["processes"] for a in active_agents if a.get("processes") is not None]
                    
                    agg_cpu = sum(valid_cpus) / len(valid_cpus) if valid_cpus else 0.05
                    agg_mem = sum(valid_mems) / len(valid_mems) if valid_mems else 35.0
                    agg_disk_read = sum(valid_disk_reads) if valid_disk_reads else 0.02
                    agg_disk_write = sum(valid_disk_writes) if valid_disk_writes else 0.02
                    agg_net_recv = sum(valid_net_recvs) if valid_net_recvs else 0.01
                    agg_net_sent = sum(valid_net_sents) if valid_net_sents else 0.01
                    agg_proc = sum(valid_procs) if valid_procs else 4.0
                    
                    current_metric_state["cpu"] = agg_cpu
                    current_metric_state["memory"] = agg_mem
                    current_metric_state["disk_read"] = agg_disk_read
                    current_metric_state["disk_write"] = agg_disk_write
                    current_metric_state["net_recv"] = agg_net_recv
                    current_metric_state["net_sent"] = agg_net_sent
                    current_metric_state["processes"] = agg_proc
                    
                    struct_time = time.localtime(now)
                    sample = {
                        "timestamp": now,
                        "hour": struct_time.tm_hour,
                        "minute": struct_time.tm_min,
                        "day_of_week": struct_time.tm_wday,
                        "cpu": agg_cpu,
                        "memory": agg_mem,
                        "disk_read": agg_disk_read,
                        "disk_write": agg_disk_write,
                        "net_recv": agg_net_recv,
                        "net_sent": agg_net_sent,
                        "processes": agg_proc,
                        "real": True
                    }
                    
                    with metrics_lock:
                        metrics_history.append(sample)
                        if len(metrics_history) > 100:
                            metrics_history.pop(0)
                    
                    # Evaluate anomaly on the aggregated fleet metrics
                    is_anomaly, score = app.ml.detector.evaluate_sample(sample)
                    
                    if is_anomaly:
                        culprit, dev, explanation, deviations, means = app.ml.detector.perform_rca(sample)
                        
                        if dev > 3.0:
                            producer = get_alerts_producer()
                            if producer:
                                try:
                                    alert_payload = {
                                        "timestamp": now,
                                        "metric": culprit,
                                        "value": sample[culprit],
                                        "expected": means[culprit],
                                        "anomaly_type": f"Contextual Anomaly ({culprit})",
                                        "severity": "critical" if dev > 6.0 else "warning",
                                        "z_score": dev,
                                        "description": explanation
                                    }
                                    producer.send('ml-alerts', alert_payload)
                                    print(f"ML: Published raw anomaly alert to Kafka for {culprit} (dev={dev:.1f})")
                                except Exception as e:
                                    print(f"ML: Failed to publish alert: {e}")
                                    
                last_agg_time = now
    except Exception as e:
        print(f"ML: Loop crash: {e}")
    finally:
        consumer.close()

if __name__ == "__main__":
    run_ml_consumer_loop()

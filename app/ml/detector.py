import os
import json
import math
import time
import threading
from sklearn.ensemble import IsolationForest
import numpy as np

from app.ml import metrics_lock, metrics_history, full_baseline_history

# Persistence File Path
HISTORY_FILE = "ml_history.json"

# ----------------------------------------------------
# Synthetic Diurnal Baseline Generator (Bootstrap)
# ----------------------------------------------------
def generate_synthetic_history():
    history = []
    now = time.time()
    # Generate 30 days of historical metrics at 5-minute intervals (8640 points)
    step = 300
    points = 30 * 288
    
    # Linear congruential generator for deterministic pseudo-random sequences
    state = 42
    def lcg_random():
        nonlocal state
        state = (1103515245 * state + 12345) & 0x7fffffff
        return state / 2147483647.0

    for i in range(points):
        t = now - (points - i) * step
        struct_time = time.localtime(t)
        hour = struct_time.tm_hour
        minute = struct_time.tm_min
        day_of_week = struct_time.tm_wday
        
        # Diurnal load factor (peaks at 2:00 PM, dips at 2:00 AM)
        time_factor = math.sin((hour + minute/60.0 - 8.0) * math.pi / 12.0)
        
        # Weekend factor
        weekend_mult = 0.4 if day_of_week >= 5 else 1.0
        
        # CPU Load: idle range 0.02 to 0.15
        base_cpu = 0.07 + time_factor * 0.04
        cpu = max(0.01, (base_cpu * weekend_mult) + (lcg_random() * 0.02 - 0.01))
        
        # Memory: idle range 32.0% to 38.0%
        base_mem = 35.0 + time_factor * 2.0
        memory = max(15.0, base_mem + (lcg_random() * 0.8 - 0.4))
        
        # Disk IO Rates (MB/s): correlates with CPU
        disk_read = max(0.01, (cpu * 0.8) + (lcg_random() * 0.03 - 0.015))
        disk_write = max(0.01, (cpu * 0.6) + (lcg_random() * 0.02 - 0.01))
        
        # Network IO Rates (MB/s): correlates with CPU
        net_recv = max(0.01, (cpu * 0.9) + (lcg_random() * 0.03 - 0.015))
        net_sent = max(0.01, (cpu * 1.1) + (lcg_random() * 0.04 - 0.02))
        
        # Processes count: idle range 3.0 to 6.0
        processes = max(2, int(4 + cpu * 8 + (lcg_random() * 2 - 1)))
        
        # Scheduled nightly backup (Mon-Fri 2:00 AM to 2:25 AM)
        if hour == 2 and 0 <= minute < 25 and day_of_week < 5:
            cpu += 0.15
            disk_write += 12.0
            net_sent += 8.0
            memory += 2.0
            
        history.append({
            "timestamp": t,
            "hour": hour,
            "minute": minute,
            "day_of_week": day_of_week,
            "cpu": cpu,
            "memory": memory,
            "disk_read": disk_read,
            "disk_write": disk_write,
            "net_recv": net_recv,
            "net_sent": net_sent,
            "processes": float(processes)
        })
        
    return history

def load_persisted_state():
    global full_baseline_history, metrics_history
    
    # Load full baseline history
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                loaded_history = json.load(f)
            print(f"ML: Loaded {len(loaded_history)} history entries from file.")
            
            full_baseline_history.clear()
            full_baseline_history.extend(loaded_history)
            
            with metrics_lock:
                metrics_history.clear()
                metrics_history.extend(loaded_history[-100:])
        except Exception as e:
            print(f"ML: Failed loading history file: {e}")

def save_metrics_history_to_file(detector_history):
    try:
        with open(HISTORY_FILE, "w") as f:
            json.dump(detector_history, f, indent=2)
    except Exception as e:
        print(f"ML: Error saving history to file: {e}")

# ----------------------------------------------------
# Unsupervised Anomaly Detection Class
# ----------------------------------------------------
class DiurnalAnomalyDetector:
    def __init__(self):
        # Initial boot: load metrics history or generate synthetic history
        load_persisted_state()
        
        with metrics_lock:
            if not full_baseline_history:
                print("ML: No history file found. Generating 30-day baseline...")
                self.history = generate_synthetic_history()
                # Copy baseline to metrics_history
                for item in self.history[-100:]:
                    metrics_history.append(item)
                save_metrics_history_to_file(self.history)
            else:
                self.history = list(full_baseline_history)
                # If historical entries are too few, pad them to ensure scikit-learn works
                if len(self.history) < 100:
                    self.history = generate_synthetic_history()[:-len(self.history)] + self.history

        self.model = None
        self.score_threshold = 0.0
        self.hourly_baselines = {}
        self.new_data_buffer = []
        self.lock = threading.Lock()
        self.retrain_count = 0
        
        self.fit_model()
        
    def fit_model(self):
        with self.lock:
            history_copy = list(self.history)
            
        X = []
        for h in history_copy:
            X.append([
                h["hour"], h["minute"], h["day_of_week"],
                h["cpu"], h["memory"], h["disk_read"], h["disk_write"],
                h["net_recv"], h["net_sent"], h["processes"]
            ])
        X_np = np.array(X)
        
        # Fit Isolation Forest outside lock for speed
        model = IsolationForest(n_estimators=40, contamination=0.015, random_state=42)
        model.fit(X_np)
        
        scores = model.decision_function(X_np)
        score_threshold = np.percentile(scores, 1.5)
        
        # Precalculate hourly baselines (avg and std) outside lock
        metrics_keys = ["cpu", "memory", "disk_read", "disk_write", "net_recv", "net_sent", "processes"]
        hourly_baselines = {}
        for hour in range(24):
            matching_points = [p for p in history_copy if p["hour"] == hour]
            if not matching_points:
                matching_points = history_copy
            
            hour_stats = {}
            for k in metrics_keys:
                vals = [p[k] for p in matching_points]
                avg = sum(vals) / len(vals)
                var = sum((x - avg)**2 for x in vals) / len(vals)
                std = math.sqrt(var) if var > 0.0 else 0.05
                hour_stats[k] = {"mean": avg, "std": std}
            hourly_baselines[hour] = hour_stats
        
        # Swap model variables under brief lock
        with self.lock:
            self.model = model
            self.score_threshold = score_threshold
            self.hourly_baselines = hourly_baselines
            self.retrain_count += 1
            
        print(f"ML: Isolation Forest fitted! Threshold score: {score_threshold:.4f}. Retrain index: {self.retrain_count}")
 
    def evaluate_sample(self, sample):
        feat = np.array([[
            sample["hour"], sample["minute"], sample["day_of_week"],
            sample["cpu"], sample["memory"], sample["disk_read"], sample["disk_write"],
            sample["net_recv"], sample["net_sent"], sample["processes"]
        ]])
        
        score = self.model.decision_function(feat)[0]
        is_anomaly = score < self.score_threshold
        
        # Buffer new metrics
        self.new_data_buffer.append(sample)
        if len(self.new_data_buffer) >= 30:
            threading.Thread(target=self.trigger_background_retrain, daemon=True).start()
            
        return is_anomaly, score

    def trigger_background_retrain(self):
        with self.lock:
            buffer_copy = list(self.new_data_buffer)
            self.new_data_buffer = []
            
            # Slide baseline window (keep max 10000 entries)
            self.history = self.history[len(buffer_copy):] + buffer_copy
            if len(self.history) > 10000:
                self.history = self.history[-10000:]
                
        self.fit_model()
        save_metrics_history_to_file(self.history)

    def perform_rca(self, sample):
        hour = sample["hour"]
        with self.lock:
            baselines = self.hourly_baselines.get(hour)
            
        metrics_keys = ["cpu", "memory", "disk_read", "disk_write", "net_recv", "net_sent", "processes"]
        
        # Fallback if baselines not generated yet or missing
        if not baselines:
            baselines = {k: {"mean": sample[k], "std": 0.05} for k in metrics_keys}
            
        deviations = {}
        means = {}
        
        for k in metrics_keys:
            avg = baselines[k]["mean"]
            std = baselines[k]["std"]
            means[k] = avg
            
            dev = abs(sample[k] - avg) / std
            deviations[k] = dev
            
        # Culprit driver
        primary_driver = max(deviations, key=deviations.get)
        driver_dev = deviations[primary_driver]
        
        metric_labels = {
            "cpu": "CPU Load Average",
            "memory": "System Memory Utilization",
            "disk_read": "Disk Read Operations",
            "disk_write": "Disk Write Operations",
            "net_recv": "Network Traffic Received",
            "net_sent": "Network Traffic Sent",
            "processes": "Active Processes Count"
        }
        
        driver_label = metric_labels.get(primary_driver, primary_driver)
        current_val = sample[primary_driver]
        expected_val = means[primary_driver]
        
        direction = "higher" if current_val > expected_val else "lower"
        unit_labels = {"cpu": "", "memory": "%", "disk_read": " MB/s", "disk_write": " MB/s", "net_recv": " MB/s", "net_sent": " MB/s", "processes": ""}
        unit = unit_labels.get(primary_driver, "")
        
        explanation = (
            f"Anomalous metric signature detected. Primary driver: {driver_label} is running {direction} "
            f"than expected ({current_val:.1f}{unit} vs normal average of {expected_val:.1f}{unit} for this hour). "
            f"Hourly baseline deviation score: {driver_dev:.1f} standard deviations."
        )
        
        return primary_driver, driver_dev, explanation, deviations, means

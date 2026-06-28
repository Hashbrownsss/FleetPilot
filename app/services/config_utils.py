import re
import yaml

def deep_merge(dict1, dict2):
    """Recursively merges dict2 into dict1."""
    for key, val in dict2.items():
        if isinstance(val, dict) and key in dict1 and isinstance(dict1[key], dict):
            deep_merge(dict1[key], val)
        else:
            dict1[key] = val
    return dict1

def merge_otel_configs(base_yaml_str: str, override_yaml_str: str) -> str:
    if not base_yaml_str:
        return override_yaml_str or ""
    if not override_yaml_str:
        return base_yaml_str
    try:
        base_dict = yaml.safe_load(base_yaml_str) or {}
    except Exception as e:
        base_dict = {}
        print(f"Backend YAML error: Failed to parse base config: {e}")
    try:
        override_dict = yaml.safe_load(override_yaml_str) or {}
    except Exception as e:
        override_dict = {}
        print(f"Backend YAML error: Failed to parse override: {e}")

    merged = deep_merge(base_dict, override_dict)
    return yaml.dump(merged, default_flow_style=False)

def validate_config_guards(yaml_str: str, agent_os: str, env: str):
    try:
        cfg = yaml.safe_load(yaml_str) or {}
    except Exception as e:
        return f"YAML Structural Parsing Error: {str(e)}"
        
    receivers = cfg.get("receivers", {}) or {}
    
    # 1. OS Compatibility Check
    windows_only = ["windowsperfcounters", "windowseventlog"]
    linux_only = ["journald"]
    
    for rx_key in receivers.keys():
        rx_type = rx_key.split("/")[0]
        # Windows Counters Check
        if rx_type in windows_only and agent_os != "windows":
            return f"OS Compatibility Guard: Component '{rx_key}' is Windows-only, but target agent OS is '{agent_os}'."
        # Linux Journald Check
        if rx_type in linux_only and agent_os != "linux":
            return f"OS Compatibility Guard: Component '{rx_key}' is Linux-only, but target agent OS is '{agent_os}'."

    # 2. Environment Deployment Phase Rules
    if env == "prod":
        # Check Scrape Collection Interval: block aggressive scrapes (< 5 seconds)
        for rx_key, rx_val in receivers.items():
            if isinstance(rx_val, dict) and "collection_interval" in rx_val:
                val_str = str(rx_val["collection_interval"])
                match = re.search(r"(\d+)", val_str)
                if match:
                    seconds = int(match.group(1))
                    if seconds < 5:
                        return f"Deployment Guard (PROD): Collection interval for '{rx_key}' is {val_str}. Intervals under 5s are blocked in Production to prevent service degradation."
        
        # Check HTTP vs HTTPS exporter endpoints (block insecure http unless local)
        exporters = cfg.get("exporters", {}) or {}
        for exp_key, exp_val in exporters.items():
            if isinstance(exp_val, dict) and "endpoint" in exp_val:
                endpoint = str(exp_val["endpoint"])
                if "http://" in endpoint and "localhost" not in endpoint and "127.0.0.1" not in endpoint:
                    return f"Deployment Guard (PROD): Insecure HTTP exporter endpoint '{endpoint}' is blocked in Production. Exporter '{exp_key}' must use HTTPS ssl context."
                    
    return None

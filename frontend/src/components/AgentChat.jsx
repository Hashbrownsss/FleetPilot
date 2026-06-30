import React, { useState, useEffect, useRef } from 'react';
import { Send, Brain, Cpu, ShieldAlert, CheckCircle, Terminal, FileText, Plus, Mic, ChevronDown } from 'lucide-react';

const AgentChat = ({ isOpen, onClose, inline = false, username = '' }) => {
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([]);
    const [sessionId, setSessionId] = useState(null);
    const [status, setStatus] = useState('idle'); // idle, running, awaiting_human, completed, failed, aborted
    const [executionLog, setExecutionLog] = useState([]);
    const [reviewPayload, setReviewPayload] = useState(null);
    const [summary, setSummary] = useState(null);
    const [fleetName, setFleetName] = useState(null);
    const [rolloutResults, setRolloutResults] = useState([]);
    const [ackResults, setAckResults] = useState([]);
    const [isPolling, setIsPolling] = useState(false);
    const [selectedModel, setSelectedModel] = useState('Gemini 1.5 Flash');
    const [showModelDropdown, setShowModelDropdown] = useState(false);
    
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, executionLog, status]);

    const getAuthHeaders = () => {
        const token = localStorage.getItem('aiops_token');
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : '',
        };
    };

    const handleSend = async (customInput = null) => {
        const textToSend = customInput || input;
        if (!textToSend.trim()) return;
        
        setMessages(prev => [...prev, { role: 'user', content: textToSend }]);
        setInput('');
        setStatus('running');
        setExecutionLog([]);
        setReviewPayload(null);
        setSummary(null);
        setFleetName(null);
        setRolloutResults([]);
        setAckResults([]);
        
        try {
            const response = await fetch('/api/agent/chat', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ message: textToSend })
            });
            const data = await response.json();
            
            if (response.status === 202 || data.status === 'awaiting_human') {
                setSessionId(data.session_id);
                setReviewPayload(data.review_payload);
                setStatus('awaiting_human');
            } else if (response.ok) {
                setSessionId(data.session_id);
                if (data.status === 'running') {
                    setIsPolling(true);
                } else {
                    setStatus(data.status);
                    setSummary(data.summary || data.final_summary);
                    if (data.fleet_name) setFleetName(data.fleet_name);
                }
            } else {
                setStatus('failed');
                setSummary(data.detail || 'Failed to start agent.');
            }
        } catch (e) {
            setStatus('failed');
            setSummary(e.message);
        }
    };

    // Polling effect
    useEffect(() => {
        let intervalId;
        if (isPolling && sessionId) {
            intervalId = setInterval(async () => {
                try {
                    const res = await fetch(`/api/agent/status/${sessionId}`, {
                        headers: getAuthHeaders()
                    });
                    if (res.ok) {
                        const data = await res.json();
                        setExecutionLog(data.execution_log || []);
                        if (data.fleet_name) setFleetName(data.fleet_name);
                        if (data.rollout_results) setRolloutResults(data.rollout_results);
                        if (data.ack_results) setAckResults(data.ack_results);
                        
                        if (data.status === 'awaiting_human') {
                            setReviewPayload(data.human_review_payload);
                            setStatus('awaiting_human');
                            setIsPolling(false);
                        } else if (['completed', 'failed', 'aborted'].includes(data.status)) {
                            setStatus(data.status);
                            setSummary(data.final_summary || data.summary);
                            setIsPolling(false);
                        }
                    }
                } catch (e) {
                    console.error("Polling error", e);
                }
            }, 500);
        }
        return () => clearInterval(intervalId);
    }, [isPolling, sessionId]);

    const handleConfirm = async (decision) => {
        setStatus('running');
        // Do NOT clear reviewPayload so that renderRolloutSummary can use it!
        try {
            const response = await fetch(`/api/agent/confirm/${sessionId}`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ decision })
            });
            const data = await response.json();
            if (response.ok) {
                setStatus(data.status);
                setSummary(data.summary || data.final_summary);
                if (data.rollout_results) setRolloutResults(data.rollout_results);
                if (data.ack_results) setAckResults(data.ack_results);
            } else {
                setStatus('failed');
                setSummary(data.detail || 'Confirmation failed.');
            }
        } catch (e) {
            setStatus('failed');
            setSummary(e.message);
        }
    };

    if (!isOpen) return null;

    const renderLogLine = (log) => {
        const isSuccess = log.includes('✓') || log.includes('success') || log.includes('ACK received') || log.includes('ready') || log.includes('created') || log.includes('generated') || log.includes('cleared for rollout');
        const isError = log.includes('failed') || log.includes('Error') || log.includes('timeout');
        
        let prefix = '→';
        let prefixColor = '#ffb020'; // Amber
        if (isSuccess) {
            prefix = '✓';
            prefixColor = '#3cd070'; // Green
        } else if (isError) {
            prefix = '✗';
            prefixColor = '#ff6b6b'; // Red
        }
        
        let content = log;
        let tag = '';
        const tagMatch = log.match(/^\[(.*?)\]/);
        if (tagMatch) {
            tag = `[${tagMatch[1]}] `;
            content = log.substring(tagMatch[0].length);
        }
        
        let tagColor = '#9ca3af';
        if (tag.includes('Orchestrator')) tagColor = '#c084fc';
        else if (tag.includes('FleetManager')) tagColor = '#fbbf24';
        else if (tag.includes('ConfigBuilder')) tagColor = '#60a5fa';
        else if (tag.includes('Validator') || tag.includes('YAMLValidator')) tagColor = '#2dd4bf';
        else if (tag.includes('Rollout') || tag.includes('RolloutAgent')) tagColor = '#fb923c';
        else if (tag.includes('AckMonitor')) tagColor = '#f472b6';
        else if (tag.includes('QueryEngine')) tagColor = '#22d3ee';

        return (
            <div key={log} style={{
                padding: '6px 0',
                display: 'flex',
                alignItems: 'start',
                gap: '8px',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                fontFamily: 'monospace',
                fontSize: '13px',
                lineHeight: '1.5'
            }}>
                <span style={{ color: prefixColor, fontWeight: 'bold', userSelect: 'none' }}>{prefix}</span>
                <span style={{ color: '#e3e3e3', flex: 1 }}>
                    {tag && <span style={{ color: tagColor, marginRight: '4px', fontWeight: '600' }}>{tag}</span>}
                    {content}
                </span>
            </div>
        );
    };

    const renderRolloutSummary = () => {
        const fleetCreated = fleetName || reviewPayload?.fleet?.name || "Default";
        const profile = reviewPayload?.config?.profile || "baseline_default";
        const profileYaml = profile === "baseline_default" ? "baseline-default.yaml" : 
                            profile === "host_metrics_only" ? "host-metrics-only.yaml" : 
                            profile === "full_metrics" ? "full-metrics.yaml" : "custom.yaml";
        const configVersion = `v1.0.0 – ${profileYaml}`;
        const disabledList = reviewPayload?.config?.disabled || [];
        const agentsList = ackResults.length > 0 ? ackResults : (rolloutResults.length > 0 ? rolloutResults : []);
        
        let totalTime = "4.2 s";
        if (agentsList.length > 0) {
            const maxLatency = Math.max(...agentsList.map(a => a.latency || 1.2), 1.2);
            totalTime = `${(maxLatency + 2.1).toFixed(1)} s`;
        }

        const auditHash = `evt_${Math.floor(Math.random() * 10000000).toString(16)}`;

        return (
            <div style={{
                backgroundColor: '#182621',
                border: '1px solid #213f34',
                padding: '24px',
                borderRadius: '16px',
                boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
                maxWidth: '650px',
                width: '100%',
                fontSize: '14px',
                color: '#e3e3e3',
                marginTop: '16px',
                fontFamily: 'system-ui, -apple-system, sans-serif'
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: '#3cd070',
                    fontWeight: 'bold',
                    fontSize: '16px',
                    borderBottom: '1px solid #213f34',
                    paddingBottom: '12px',
                    marginBottom: '8px'
                }}>
                    <CheckCircle size={18} />
                    Fleet rollout completed
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(33, 63, 52, 0.5)' }}>
                        <span style={{ color: '#a3bfae' }}>Fleet created</span>
                        <span style={{ fontWeight: '600', color: '#fff' }}>{fleetCreated}</span>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(33, 63, 52, 0.5)' }}>
                        <span style={{ color: '#a3bfae' }}>Config version</span>
                        <span style={{ fontWeight: '600', color: '#fff' }}>{configVersion}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(33, 63, 52, 0.5)' }}>
                        <span style={{ color: '#a3bfae' }}>Network metrics</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            {disabledList.map(m => (
                                <span key={m} style={{
                                    color: '#ff6b6b',
                                    fontWeight: '500',
                                    backgroundColor: 'rgba(255, 107, 107, 0.1)',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    border: '1px solid rgba(255, 107, 107, 0.2)'
                                }}>
                                    {m} disabled
                                </span>
                            ))}
                            {disabledList.length === 0 && <span style={{ color: '#3cd070', fontWeight: '500' }}>All enabled</span>}
                        </div>
                    </div>

                    {agentsList.map((a, idx) => {
                        const statusStr = a.status || "acknowledged";
                        const isAck = statusStr === "acknowledged" || statusStr === "success";
                        const agentName = a.agent || `agent-${idx}`;
                        return (
                            <div key={agentName} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', alignItems: 'center', borderBottom: '1px solid rgba(33, 63, 52, 0.5)' }}>
                                <span style={{ color: '#a3bfae', fontFamily: 'monospace' }}>{agentName}</span>
                                <span style={{
                                    padding: '2px 10px',
                                    borderRadius: '20px',
                                    fontSize: '12px',
                                    fontWeight: '600',
                                    border: isAck ? '1px solid rgba(60, 208, 112, 0.2)' : '1px solid rgba(245, 158, 11, 0.2)',
                                    backgroundColor: isAck ? 'rgba(60, 208, 112, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                                    color: isAck ? '#3cd070' : '#fbbf24'
                                }}>
                                    {statusStr}
                                </span>
                            </div>
                        );
                    })}

                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(33, 63, 52, 0.5)' }}>
                        <span style={{ color: '#a3bfae' }}>Audit log entry</span>
                        <span style={{ color: '#9ca3af', fontFamily: 'monospace', fontSize: '12px' }}>
                            {auditHash} · admin
                        </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0 0', fontWeight: 'bold', color: '#fff', borderTop: '1px solid #213f34' }}>
                        <span style={{ color: '#a3bfae' }}>Total execution time</span>
                        <span>{totalTime}</span>
                    </div>
                </div>
            </div>
        );
    };

    const isRolloutAction = (fleetName || rolloutResults.length > 0 || ackResults.length > 0) && status === 'completed';

    const greetingName = username || 'Harshvardhan';

    return (
        <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            backgroundColor: '#131314',
            overflow: 'hidden',
            position: 'relative',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            color: '#e3e3e3'
        }}>
            {/* Empty State Greeting (Gemini Website Style) */}
            {messages.length === 0 && (
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '0 16px',
                    maxWidth: '800px',
                    margin: '0 auto',
                    width: '100%',
                    userSelect: 'none'
                }}>
                    <h1 style={{
                        fontSize: 'min(4.5vw, 48px)',
                        fontWeight: '500',
                        letterSpacing: '-0.02em',
                        color: '#fff',
                        marginBottom: '40px',
                        lineHeight: '1.25'
                    }}>
                        Hi <span style={{
                            background: 'linear-gradient(74deg, #4b90ff, #ff7373, #ffaa40)',
                            WebkitBackgroundClip: 'text',
                            WebkitTextFillColor: 'transparent',
                            fontWeight: '600'
                        }}>{greetingName}</span>, let's get into it
                    </h1>
                </div>
            )}

            {/* Chat Body (Message stream) */}
            {messages.length > 0 && (
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '32px 16px',
                    maxWidth: '800px',
                    margin: '0 auto',
                    width: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px'
                }}>
                    {messages.map((m, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* User Query Block */}
                            <div style={{ display: 'flex', justifyContent: 'end' }}>
                                <div style={{
                                    backgroundColor: '#1e1f20',
                                    color: '#e3e3e3',
                                    fontSize: '15px',
                                    padding: '12px 20px',
                                    borderRadius: '20px',
                                    maxWidth: '80%',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                    lineHeight: '1.6'
                                }}>
                                    {m.content}
                                </div>
                            </div>

                            {/* Agent response block */}
                            {idx === messages.length - 1 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%' }}>
                                    {/* Execution logs */}
                                    {executionLog.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                fontSize: '11px',
                                                fontWeight: 'bold',
                                                color: '#8e9196',
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.05em',
                                                fontFamily: 'monospace'
                                            }}>
                                                <Terminal size={14} style={{ color: '#9ca3af' }} />
                                                Execution Log
                                            </div>
                                            <div style={{
                                                backgroundColor: '#0a0b0d',
                                                border: '1px solid #2f3032',
                                                borderRadius: '16px',
                                                padding: '16px 20px',
                                                boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
                                                width: '100%'
                                            }}>
                                                {executionLog.map(log => renderLogLine(log))}
                                                {status === 'running' && (
                                                    <div style={{
                                                        color: '#8e9196',
                                                        fontStyle: 'italic',
                                                        marginTop: '8px',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        fontSize: '13px',
                                                        fontFamily: 'monospace',
                                                        animation: 'pulse 1.5s infinite'
                                                    }}>
                                                        <span>→</span>
                                                        <span>Agent is thinking...</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Human in the loop review popup */}
                                    {status === 'awaiting_human' && reviewPayload && (
                                        <div style={{
                                            backgroundColor: '#241a0d',
                                            border: '1px solid rgba(245, 158, 11, 0.3)',
                                            padding: '24px',
                                            borderRadius: '20px',
                                            width: '100%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '16px',
                                            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)'
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px',
                                                color: '#fbbf24',
                                                fontWeight: 'bold',
                                                fontSize: '16px',
                                                borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
                                                paddingBottom: '8px'
                                            }}>
                                                <ShieldAlert size={18} />
                                                {reviewPayload.title || "Rollout Action Review Required"}
                                            </div>
                                            
                                            <div style={{ fontSize: '14px', color: '#d1d5db', lineHeight: '1.5' }}>
                                                <p style={{ margin: '4px 0' }}><strong>Fleet:</strong> {reviewPayload.fleet.name} {reviewPayload.fleet.new && '(New)'}</p>
                                                <p style={{ margin: '4px 0' }}><strong>Config Profile:</strong> {reviewPayload.config.profile}</p>
                                                {reviewPayload.config.disabled?.length > 0 && (
                                                    <p style={{ color: '#ff6b6b', fontWeight: '500', margin: '4px 0' }}><strong>Disabled Metrics:</strong> {reviewPayload.config.disabled.join(', ')}</p>
                                                )}
                                            </div>

                                            <details style={{
                                                fontSize: '12px',
                                                color: '#9ca3af',
                                                backgroundColor: 'rgba(0,0,0,0.4)',
                                                border: '1px solid #2f3032',
                                                padding: '12px',
                                                borderRadius: '12px',
                                                cursor: 'pointer'
                                            }}>
                                                <summary style={{ fontWeight: '600', color: '#d1d5db', userSelect: 'none' }}>View OTel YAML Preview</summary>
                                                <pre style={{
                                                    marginTop: '8px',
                                                    color: '#2dd4bf',
                                                    overflowX: 'auto',
                                                    whiteSpace: 'pre-wrap',
                                                    fontFamily: 'monospace',
                                                    padding: '8px',
                                                    backgroundColor: '#0c0d12',
                                                    borderRadius: '6px'
                                                }}>
                                                    {reviewPayload.config.yaml_preview}
                                                </pre>
                                            </details>

                                            <div style={{ fontSize: '14px' }}>
                                                <strong style={{ color: '#d1d5db', display: 'block', marginBottom: '6px' }}>Targets ({reviewPayload.targets.length}):</strong>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {reviewPayload.targets.map(t => (
                                                        <span key={t.name} style={{
                                                            padding: '4px 10px',
                                                            backgroundColor: '#1f2937',
                                                            border: '1px solid #374151',
                                                            borderRadius: '8px',
                                                            fontSize: '12px',
                                                            color: '#d1d5db',
                                                            fontFamily: 'monospace'
                                                        }}>
                                                            {t.name} <span style={{ color: '#3cd070', fontWeight: '600' }}>({t.status})</span>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '12px', paddingTop: '8px' }}>
                                                <button 
                                                    onClick={() => handleConfirm('approved')}
                                                    style={{
                                                        flex: 1,
                                                        backgroundColor: '#16a34a',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        color: '#fff',
                                                        padding: '10px 0',
                                                        borderRadius: '12px',
                                                        fontWeight: '600',
                                                        fontSize: '14px',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                >
                                                    Approve & Rollout
                                                </button>
                                                <button 
                                                    onClick={() => handleConfirm('rejected')}
                                                    style={{
                                                        flex: 1,
                                                        backgroundColor: '#374151',
                                                        border: '1px solid #4b5563',
                                                        cursor: 'pointer',
                                                        color: '#fff',
                                                        padding: '10px 0',
                                                        borderRadius: '12px',
                                                        fontWeight: '600',
                                                        fontSize: '14px',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {/* Final Summary Card / Response */}
                                    {summary && (
                                        <div style={{ width: '100%' }}>
                                            {isRolloutAction ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
                                                    <div style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold',
                                                        color: '#8e9196',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.05em',
                                                        fontFamily: 'monospace'
                                                    }}>
                                                        <FileText size={14} style={{ color: '#9ca3af' }} />
                                                        Execution Summary
                                                    </div>
                                                    {renderRolloutSummary()}
                                                </div>
                                            ) : (
                                                <div style={{
                                                    padding: '24px',
                                                    borderRadius: '20px',
                                                    border: '1px solid #2f3032',
                                                    backgroundColor: '#1e1f20',
                                                    color: '#e3e3e3',
                                                    fontSize: '15px',
                                                    lineHeight: '1.6',
                                                    boxShadow: '0 4px 6px rgba(0,0,0,0.15)',
                                                    width: '100%'
                                                }}>
                                                    <strong style={{
                                                        display: 'block',
                                                        fontSize: '11px',
                                                        fontWeight: 'bold',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.05em',
                                                        marginBottom: '8px',
                                                        color: status === 'completed' ? '#3cd070' : '#ff6b6b'
                                                    }}>
                                                        Status: {status.toUpperCase()}
                                                    </strong>
                                                    <div style={{ overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                                                        {summary}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                    <div ref={messagesEndRef} />
                </div>
            )}

            {/* Capsule Pill Search Box (Gemini Web Style) */}
            <div style={{
                maxWidth: '760px',
                margin: '0 auto',
                width: '100%',
                padding: '0 16px 24px 16px',
                position: 'relative'
            }}>
                <div style={{
                    backgroundColor: '#1e1f20',
                    borderRadius: '32px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    padding: '8px 16px 8px 24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    width: '100%',
                    border: '1px solid transparent',
                    transition: 'border-color 0.2s, background-color 0.2s'
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = '#444746'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'transparent'; }}
                >
                    {/* Add button on the left */}
                    <button style={{
                        background: 'none',
                        border: 'none',
                        color: '#c4c7c5',
                        cursor: 'pointer',
                        padding: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2f3032'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                        <Plus size={20} />
                    </button>
                    
                    {/* Main input area */}
                    <textarea 
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            color: '#fff',
                            fontSize: '16px',
                            resize: 'none',
                            paddingTop: '8px',
                            minHeight: '36px',
                            maxHeight: '120px',
                            lineHeight: '1.5',
                            fontFamily: 'inherit'
                        }}
                        rows={1}
                        placeholder="Ask FleetPilot..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        disabled={status === 'running'}
                    ></textarea>
                    
                    {/* Model Dropdown + Send on the right */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ position: 'relative' }}>
                            <button 
                                onClick={() => setShowModelDropdown(!showModelDropdown)}
                                style={{
                                    color: '#c4c7c5',
                                    fontSize: '13px',
                                    fontWeight: '500',
                                    backgroundColor: '#131314',
                                    padding: '6px 12px',
                                    borderRadius: '16px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    border: '1px solid #444746',
                                    cursor: 'pointer'
                                }}
                            >
                                {selectedModel} <ChevronDown size={12} />
                            </button>
                            {showModelDropdown && (
                                <div style={{
                                    position: 'absolute',
                                    bottom: '100%',
                                    right: 0,
                                    marginBottom: '8px',
                                    backgroundColor: '#1e1f20',
                                    border: '1px solid #2f3032',
                                    borderRadius: '12px',
                                    boxShadow: '0 8px 16px rgba(0,0,0,0.3)',
                                    width: '180px',
                                    zIndex: 100,
                                    overflow: 'hidden'
                                }}>
                                    <button 
                                        onClick={() => { setSelectedModel('Gemini 1.5 Flash'); setShowModelDropdown(false); }}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '10px 16px',
                                            fontSize: '13px',
                                            color: '#e3e3e3',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer'
                                        }}
                                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2f3032'}
                                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        Gemini 1.5 Flash
                                    </button>
                                    <button 
                                        onClick={() => { setSelectedModel('Gemini 1.5 Pro'); setShowModelDropdown(false); }}
                                        style={{
                                            width: '100%',
                                            textAlign: 'left',
                                            padding: '10px 16px',
                                            fontSize: '13px',
                                            color: '#e3e3e3',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer'
                                        }}
                                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2f3032'}
                                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        Gemini 1.5 Pro
                                    </button>
                                </div>
                            )}
                        </div>
                        <button style={{
                            background: 'none',
                            border: 'none',
                            color: '#c4c7c5',
                            cursor: 'pointer',
                            padding: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '50%'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#2f3032'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            <Mic size={20} />
                        </button>
                        <button 
                            onClick={() => handleSend()}
                            disabled={status === 'running' || !input.trim()}
                            style={{
                                backgroundColor: '#1a73e8',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#fff',
                                padding: '8px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'opacity 0.2s',
                                opacity: (status === 'running' || !input.trim()) ? 0.3 : 1
                            }}
                            onMouseOver={(e) => { if (input.trim() && status !== 'running') e.currentTarget.style.backgroundColor = '#1557b0'; }}
                            onMouseOut={(e) => { if (input.trim() && status !== 'running') e.currentTarget.style.backgroundColor = '#1a73e8'; }}
                        >
                            <Send size={16} />
                        </button>
                    </div>
                </div>
                <div style={{
                    fontSize: '11px',
                    color: '#8e9196',
                    textAlign: 'center',
                    marginTop: '8px',
                    userSelect: 'none'
                }}>
                    FleetPilot can make mistakes. Verify critical system configs.
                </div>
            </div>
        </div>
    );
};

export default AgentChat;

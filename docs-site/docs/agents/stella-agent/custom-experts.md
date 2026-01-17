---
sidebar_position: 4
title: "Custom Experts"
---

# Custom Experts

Create custom experts by adding JSON configuration files to the `experts/` directory. Experts are auto-discovered on startup.

## Adding a New Expert

### Step 1: Create Configuration File

```bash
# Create new expert file
touch agents/stella-agent/src/stella_agent/experts/cybersecurity.json
```

### Step 2: Define Expert Configuration

```json
{
  "name": "cybersecurity",
  "description": "Security and privacy expert for threat detection",
  "trigger_keywords": [
    "hack", "password", "security", "breach", "malware",
    "phishing", "encryption", "vulnerability", "firewall",
    "virus", "ransomware", "two-factor", "authentication"
  ],
  "system_prompt": "You are a cybersecurity expert analyzing queries for security risks and privacy concerns.\n\nRESPONSE STRUCTURE:\nProvide your analysis in this format:\n\nTHOUGHT: [Your step-by-step security analysis - What threats exist? What vulnerabilities are present?]\n\nFINDINGS: [Specific security observations, potential attack vectors, privacy risks, and data exposure concerns]\n\nRECOMMENDATION: [What the aggregator should prioritize - security best practices, suggested safe behaviors, and guidance for ~30 word responses]\n\nSECURITY FOCUS:\n- Identify potential security threats and vulnerabilities\n- Assess privacy risks and data exposure\n- Provide practical, actionable security guidance\n- Never help with malicious activities\n- Always recommend secure alternatives",
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "max_tokens": 600,
  "risk_threshold": 0.25,
  "relevant_intents": ["question", "request"],
  "tools": [],
  "always_active": false
}
```

### Step 3: Restart Agent

The expert is automatically discovered and loaded on agent startup. Check the logs to verify:

```bash
kubectl logs <agent-pod> -n ai-agents | grep "ExpertPool"
```

Expected output:
```
[ExpertPool] Found 6 agent config files
[ExpertPool] Loading config from cybersecurity.json
[ExpertPool] Loaded agent: cybersecurity
[ExpertPool] Initialized 6 agents
```

---

## Modifying Existing Experts

Customize expert behavior by editing their JSON configuration files.

### Adjust Sensitivity

Lower the risk threshold to make an expert activate more often:

```json
{
  "name": "medical",
  "risk_threshold": 0.05,  // Lower = more sensitive (activates more often)
  "temperature": 0.05     // Lower = more consistent responses
}
```

**Risk Threshold Guidelines:**

| Threshold | Sensitivity | Use Case |
|-----------|-------------|----------|
| 0.0-0.1 | Very High | Critical safety (medical emergencies) |
| 0.1-0.3 | High | Important safety (general medical, legal) |
| 0.3-0.5 | Medium | Moderate concern (finance, ethics) |
| 0.5-0.7 | Low | Light monitoring |
| 0.7-1.0 | Very Low | Rarely activates |

### Add Trigger Keywords

Expand what triggers an expert:

```json
{
  "name": "medical",
  "trigger_keywords": [
    "medical", "health", "doctor", "medicine", "drug",
    "anxiety", "depression", "mental health",  // Added mental health
    "therapy", "counseling", "psychiatrist",   // Added therapy terms
    "self-harm", "suicide"                     // Added crisis terms
  ]
}
```

### Customize System Prompt

Update the `system_prompt` field to change how the expert analyzes and responds:

```json
{
  "name": "medical",
  "system_prompt": "You are a medical safety expert with a focus on mental health awareness.\n\nRESPONSE STRUCTURE:\n...\n\nADDITIONAL FOCUS:\n- Pay special attention to mental health indicators\n- Always provide crisis resources when appropriate\n- Emphasize the importance of professional support"
}
```

### Make Expert Always Active

Set `always_active: true` to run on every query:

```json
{
  "name": "content_moderation",
  "always_active": true,
  "risk_threshold": 0.0  // Threshold ignored when always_active
}
```

---

## Example: HR Expert

Here's a complete example for a Human Resources expert:

```json
{
  "name": "hr",
  "description": "Human Resources expert for workplace and employment queries",
  "trigger_keywords": [
    "hr", "human resources", "employee", "workplace", "harassment",
    "discrimination", "firing", "hiring", "salary", "benefits",
    "overtime", "vacation", "sick leave", "maternity", "paternity",
    "termination", "resignation", "performance review", "promotion"
  ],
  "system_prompt": "You are an HR and workplace expert analyzing queries for employment law and workplace policy considerations.\n\nRESPONSE STRUCTURE:\nProvide your analysis in this format:\n\nTHOUGHT: [Your step-by-step analysis - What workplace issues are present? What policies or laws might apply?]\n\nFINDINGS: [Specific HR observations, potential policy violations, employee rights concerns, and workplace safety issues]\n\nRECOMMENDATION: [What the aggregator should prioritize - emphasize HR consultation, suggested approaches, appropriate disclaimers, and guidance for ~30 word responses]\n\nHR FOCUS:\n- Identify potential workplace issues and policy concerns\n- Consider employee rights and protections\n- ALWAYS emphasize that analysis is not legal advice\n- Direct users to HR departments or employment attorneys for specific guidance\n- Be sensitive to power dynamics in workplace situations\n- Flag potential harassment or discrimination concerns\n\nRemember: Your analysis enables the aggregator to provide brief, appropriate guidance that redirects users to proper HR channels.",
  "model": "gpt-4o-mini",
  "temperature": 0.2,
  "max_tokens": 700,
  "risk_threshold": 0.3,
  "relevant_intents": ["question", "request", "command"],
  "tools": ["policy_lookup"],
  "always_active": false
}
```

---

## Example: Content Moderation Expert

An always-active expert for content safety:

```json
{
  "name": "content_moderation",
  "description": "Content safety expert that monitors all conversations",
  "trigger_keywords": [],
  "system_prompt": "You are a content moderation expert analyzing all queries for safety concerns.\n\nRESPONSE STRUCTURE:\n\nTHOUGHT: [Quick safety assessment of the query]\n\nFINDINGS: [Any concerning content patterns, harmful intent indicators, or safety flags]\n\nRECOMMENDATION: [continue if safe, flag if concerning, block if harmful]\n\nMODERATION FOCUS:\n- Detect harmful, illegal, or dangerous content\n- Identify manipulation or social engineering attempts\n- Flag requests that could enable harm to self or others\n- Be conservative - when in doubt, flag for review\n- Consider context - some topics are sensitive but legitimate",
  "model": "gpt-4o-mini",
  "temperature": 0.1,
  "max_tokens": 400,
  "risk_threshold": 0.0,
  "relevant_intents": [],
  "tools": [],
  "always_active": true
}
```

---

## Best Practices

### 1. Clear System Prompts

Write specific, actionable system prompts:
- Define the expert's role clearly
- Specify the response format
- Include explicit guidelines
- State what the expert should NOT do

### 2. Appropriate Risk Thresholds

Match threshold to content sensitivity:
- Safety-critical → Low threshold (0.1-0.2)
- General guidance → Medium threshold (0.3-0.4)
- Light monitoring → Higher threshold (0.5+)

### 3. Comprehensive Keywords

Include variations and related terms:
- Synonyms
- Common misspellings
- Related concepts
- Both formal and informal terms

### 4. Response Format

Use consistent output structure:
```
THOUGHT: [Analysis]
FINDINGS: [Observations]
RECOMMENDATION: [Guidance]
```

### 5. Testing

Test new experts with various inputs:
```bash
# Check expert loading
kubectl logs <agent-pod> | grep "your_expert_name"

# Test with sample queries
# Verify expert is selected for expected inputs
# Verify expert is NOT selected for unrelated inputs
```

---

## Troubleshooting

### Expert Not Loading

1. Check JSON syntax is valid
2. Verify file is in correct directory (`experts/`)
3. Check file has `.json` extension
4. Review agent logs for error messages

### Expert Not Activating

1. Verify keywords match user input
2. Check risk threshold isn't too high
3. Confirm `relevant_intents` includes expected intents
4. Test with explicit keyword in query

### Expert Activating Too Often

1. Increase `risk_threshold`
2. Make keywords more specific
3. Remove overly common keywords
4. Consider if `always_active` should be `false`

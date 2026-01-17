---
sidebar_position: 2
title: "Default Experts"
---

# Default Experts

The stella-agent includes 5 built-in experts located in `agents/stella-agent/src/stella_agent/experts/`:

| Expert | File | Purpose | Risk Threshold |
|--------|------|---------|----------------|
| **Medical** | `medical.json` | Health/safety advice, substance abuse detection | 0.1 |
| **Ethics** | `ethics.json` | Responsible AI, bias detection, privacy | 0.3 |
| **Legal** | `legal.json` | Legal compliance, liability concerns | 0.25 |
| **Finance** | `finance.json` | Financial analysis, fraud detection | 0.3 |
| **Timekeeper** | `timekeeper.json` | Conversation monitoring, progress tracking | 0.0 (always active) |

---

## Medical Expert

Analyzes health-related queries for safety concerns.

**File:** `medical.json`

**Risk Threshold:** `0.1` (very sensitive)

**Trigger Keywords:**
```
medical, health, doctor, medicine, drug, medication, symptom, pain,
sick, illness, disease, treatment, diagnosis, hospital, overdose,
addiction, recreational drugs, substance abuse
```

**Behavior:**
- Detects potential health risks and safety considerations
- Identifies substance abuse and addiction concerns
- Assesses urgency (emergency, urgent, routine)
- Always directs users to healthcare professionals
- Never provides specific diagnoses or treatment recommendations

**Tools Available:**
- `medical_guideline_check`
- `drug_interaction_lookup`

---

## Ethics Expert

Evaluates queries for ethical implications and responsible AI concerns.

**File:** `ethics.json`

**Risk Threshold:** `0.3`

**Trigger Keywords:**
```
ethics, moral, right, wrong, bias, fair, discrimination, privacy,
consent, responsibility, harm, manipulation, deception
```

**Behavior:**
- Identifies ethical concerns and fairness issues
- Assesses privacy implications
- Detects potential for harm or manipulation
- Considers diverse perspectives and cultural sensitivities
- Emphasizes transparency, consent, and responsible use

**Tools Available:**
- `bias_detection`
- `privacy_assessment`

---

## Legal Expert

Analyzes queries for legal implications and compliance.

**File:** `legal.json`

**Risk Threshold:** `0.25`

**Trigger Keywords:**
```
legal, law, lawyer, attorney, court, sue, contract, rights,
liability, compliance, regulation, policy, terms, agreement, lawsuit
```

**Behavior:**
- Identifies potential legal risks and regulatory requirements
- Flags policy violations and liability concerns
- Always emphasizes consulting qualified attorneys
- Maintains boundaries around legal advice
- Is cautious about jurisdiction-specific advice

**Tools Available:**
- `legal_compliance_check`
- `jurisdiction_lookup`

---

## Finance Expert

Reviews financial queries for compliance and risk factors.

**File:** `finance.json`

**Risk Threshold:** `0.3`

**Trigger Keywords:**
```
money, finance, investment, stock, crypto, bitcoin, trading, loan,
mortgage, tax, financial, budget, portfolio, market, economy
```

**Behavior:**
- Identifies investment risks and safety considerations
- Detects potential scams and fraud
- Flags regulatory compliance concerns
- Directs users to qualified financial advisors
- Avoids market predictions and specific investment recommendations

**Tools Available:**
- `compliance_check`
- `risk_assessment`

---

## Timekeeper Expert

Monitors conversation progress and prevents stalling.

**File:** `timekeeper.json`

**Risk Threshold:** `0.0`

**Special Property:** `always_active: true`

This expert is unique - it runs on **every query** regardless of content, bypassing the normal selection logic. Its purpose is to monitor conversation health, not content safety.

**Behavior:**
- Counts turns without deliverable collection
- Detects stuck or looping conversations
- Suggests deliverables that can be inferred from context
- Monitors both STRICT and LOOSE conversation modes

**Recommendations:**
- `continue` - Conversation is progressing naturally
- `update_tasks` - (Loose mode) Apply inferred deliverables
- `force_transition` - (Strict mode) Force state advancement after 2+ turns without progress

**Output Structure:**
```
THOUGHT: [Analyze conversation flow]
TURNS_WITHOUT_DELIVERABLES: [number]
IS_STUCK: [true/false]
MODE: [strict/loose]
FINDINGS: [Observations about progress]
SUGGESTED_DELIVERABLES: [JSON object or NONE]
RECOMMENDATION: [continue/update_tasks/force_transition]
REASONING: [Why this action is recommended]
```

---

## Expert Response Format

All domain experts (Medical, Ethics, Legal, Finance) structure their output using a consistent format:

```
THOUGHT: [Step-by-step analysis of the query]
FINDINGS: [Specific observations and concerns]
RECOMMENDATION: [Guidance for the aggregator]
```

This structured format allows the Aggregator to:
- Parse expert insights consistently
- Identify areas of agreement or conflict
- Synthesize findings into a coherent response

## Next Steps

- [Configuration](configuration) - Understand the configuration schema and selection logic
- [Custom Experts](custom-experts) - Add your own domain experts

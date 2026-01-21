---
sidebar_position: 1
title: "Overview"
---

# Expert Pool System

The stella-agent includes a **Parallel Expert Pool** - a sophisticated system that routes potentially sensitive queries through specialized domain experts for analysis before generating responses.

## What is the Expert Pool?

The Expert Pool provides:
- **Safety layer** for sensitive topics (medical, legal, financial, ethical)
- **Parallel expert execution** for fast, comprehensive analysis
- **Dynamic expert selection** based on content and risk scoring
- **Consensus synthesis** that resolves conflicting expert findings

## Multi-Stage Pipeline

When user input is classified as potentially sensitive, it flows through a multi-stage pipeline:

```
┌─────────────────────────────────────────────────────────────────┐
│                     EXPERT POOL PIPELINE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   User Input                                                     │
│       │                                                          │
│       ▼                                                          │
│   ┌─────────────┐                                               │
│   │  InputGate  │ ─── Routes as SAFE or UNSAFE                  │
│   │             │ ─── Selects relevant experts                  │
│   └─────────────┘                                               │
│       │                                                          │
│       ├── SAFE ────────────────────────► Direct LLM Response    │
│       │                                                          │
│       └── UNSAFE ──┐                                            │
│                    ▼                                             │
│              ┌───────────────────────────────────────┐          │
│              │         EXPERT POOL                    │          │
│              │  ┌─────────┐ ┌─────────┐ ┌─────────┐  │          │
│              │  │ Medical │ │ Ethics  │ │ Legal   │  │          │
│              │  └─────────┘ └─────────┘ └─────────┘  │          │
│              │  ┌─────────┐ ┌─────────┐              │          │
│              │  │ Finance │ │Timekeeper│ (parallel) │          │
│              │  └─────────┘ └─────────┘              │          │
│              └───────────────────────────────────────┘          │
│                    │                                             │
│                    ▼                                             │
│              ┌─────────────┐                                    │
│              │ Aggregator  │ ─── Synthesizes expert findings    │
│              └─────────────┘                                    │
│                    │                                             │
│                    ▼                                             │
│              Natural Response                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Pipeline Stages

### Stage 1: InputGate

The InputGate is the entry point that analyzes and routes user input:

- Analyzes user input for content classification
- Routes as `SAFE` (direct response) or `UNSAFE` (requires expert review)
- Selects which experts should analyze the query
- Calculates risk scores for expert activation

### Stage 2: ExpertPool

The ExpertPool executes domain experts in parallel:

- Executes selected experts in parallel using `asyncio.gather()`
- Each expert provides independent analysis
- Experts run simultaneously for faster response times
- Handles failures gracefully (one expert failing doesn't block others)

### Stage 3: Aggregator

The Aggregator synthesizes expert findings into a coherent response:

- Collects all expert results
- Analyzes conflicts and consensus
- Synthesizes findings into a natural, conversational response
- Streams response tokens in real-time

## Parallel Execution

Selected experts run concurrently for optimal performance:

```python
# All selected experts run simultaneously
tasks = [expert.analyze(input) for expert in selected_experts]
results = await asyncio.gather(*tasks, return_exceptions=True)
```

**Benefits:**
- Faster response times (experts don't wait for each other)
- Independent analysis (no expert influences another)
- Graceful error handling (one failure doesn't block others)

## Source Files Reference

| Component | File Path |
|-----------|-----------|
| Expert Pool | `agents/stella-agent/src/stella_agent/pipeline/expert_pool.py` |
| Input Gate | `agents/stella-agent/src/stella_agent/pipeline/input_gate.py` |
| Aggregator | `agents/stella-agent/src/stella_agent/pipeline/aggregator.py` |
| Expert Result | `agents/stella-agent/src/stella_agent/models/expert_result.py` |
| Expert Configs | `agents/stella-agent/src/stella_agent/experts/*.json` |

## Next Steps

- [Default Experts](default-experts) - Learn about the 5 built-in experts
- [Configuration](configuration) - Understand the configuration schema
- [Custom Experts](custom-experts) - Add your own domain experts

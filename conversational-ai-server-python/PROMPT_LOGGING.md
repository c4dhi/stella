# LLM Prompt Logging Feature

## Overview

All LLM prompts sent to OpenAI are now logged to a file for debugging and monitoring. This is especially useful in Docker environments where console output may be harder to access.

## Log File Location

**Local Development:**
```
logs/prompts/llm_prompts.log
```

**Docker Container:**
- Inside container: `/app/logs/prompts/llm_prompts.log`
- On host machine: `./logs/prompts/llm_prompts.log` (mounted via volume)

## Implementation

The logging is implemented in `message_processing/llm_service.py`:
- **Initialization**: Log directory created at startup (lines 339-342)
- **Logging method**: `_log_prompt_to_file()` (lines 395-427)
- **Called from**: `generate()` method (line 459)

## What Gets Logged

For every LLM request, the log file contains:

```
================================================================================
TIMESTAMP: 2025-09-30T13:29:42.155980
COMPONENT: INPUT_GATE
================================================================================
Model: gpt-4o-mini
Temperature: 0.3
Max Tokens: 800
Provider: openai_langchain
Streaming: True
--------------------------------------------------------------------------------
Messages:

[SYSTEM MESSAGE 1]:
<full system prompt content>
--------------------------------------------------------------------------------

[USER MESSAGE 2]:
<full user prompt content>
--------------------------------------------------------------------------------
================================================================================
```

## Docker Configuration

The `docker-compose.yml` has been updated to mount the logs directory:

```yaml
volumes:
  # Mount logs directory for LLM prompt logging
  - ./logs:/app/logs
```

This ensures:
- ✅ Logs persist between container restarts
- ✅ Logs are accessible on the host machine
- ✅ No need to exec into the container to view logs

## Accessing Logs

### From Host Machine

```bash
# View entire log file
cat logs/prompts/llm_prompts.log

# View last 100 lines
tail -100 logs/prompts/llm_prompts.log

# Follow log in real-time
tail -f logs/prompts/llm_prompts.log

# Search for specific component
grep -A 20 "COMPONENT: INPUT_GATE" logs/prompts/llm_prompts.log

# Count prompts by component
grep "COMPONENT:" logs/prompts/llm_prompts.log | sort | uniq -c
```

### From Docker Container

```bash
# View logs from inside container
docker exec -it <container_name> cat /app/logs/prompts/llm_prompts.log

# Or use docker-compose
docker-compose exec python-listener cat /app/logs/prompts/llm_prompts.log
```

## Components That Make LLM Calls

The system has 3 main components that make LLM calls, each clearly identified in logs:

### 1. **INPUT_GATE**
- **Location**: `message_processing/input_gate.py`
- **Purpose**: Routes messages and detects deliverables
- **Configuration**:
  - Model: gpt-4o-mini
  - Temperature: 0.3
  - Streaming: True

### 2. **EXPERT_[NAME]**
- **Location**: `message_processing/expert_pool.py`
- **Purpose**: Each expert agent analyzes specific domains
- **Configuration**:
  - Model: gpt-4o-mini (configurable per expert)
  - Temperature: 0.3 (configurable per expert)
  - Streaming: False
- **Example component names**:
  - `expert_health_advisor`
  - `expert_legal_advisor`
  - `expert_financial_advisor`

### 3. **AGGREGATOR**
- **Location**: `message_processing/aggregator.py`
- **Purpose**: Synthesizes expert findings into final response
- **Configuration**:
  - Model: gpt-4o-mini
  - Temperature: 0.7 (higher for more natural conversation)
  - Streaming: True

## Testing

A test script is provided to demonstrate the logging feature:

```bash
python3 test_prompt_logging.py
```

This will:
1. Create the logs directory if it doesn't exist
2. Generate sample prompts from all three component types
3. Write them to `logs/prompts/llm_prompts.log`

After running, verify with:
```bash
cat logs/prompts/llm_prompts.log
```

## Log Management

### Log Rotation

The log file is append-only and will grow over time. Consider implementing log rotation:

```bash
# Manual rotation
mv logs/prompts/llm_prompts.log logs/prompts/llm_prompts.log.$(date +%Y%m%d-%H%M%S)

# Or use logrotate (Linux)
# Add to /etc/logrotate.d/llm-prompts
/path/to/logs/prompts/llm_prompts.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

### Clearing Logs

```bash
# Clear the log file
> logs/prompts/llm_prompts.log

# Or delete it (will be recreated on next prompt)
rm logs/prompts/llm_prompts.log
```

## Benefits

1. **Debugging**: See exactly what prompts are sent to the LLM
2. **Transparency**: Understand how different agents construct their prompts
3. **Optimization**: Identify opportunities to improve prompt engineering
4. **Monitoring**: Track which components are making LLM calls
5. **Development**: Easier to debug issues with LLM responses
6. **Docker-friendly**: Accessible without entering the container
7. **Persistent**: Logs survive container restarts

## Configuration

### Custom Log Directory

You can specify a custom log directory when initializing LLMService:

```python
llm_service = LLMService(
    config_path="llm_config.json",
    prompt_log_dir="custom/log/path"
)
```

### Disable Logging

To disable prompt logging, modify `message_processing/llm_service.py` line 459:
```python
# Comment out this line:
# self._log_prompt_to_file(component_name, messages, config, provider.get_provider_name())
```

## Performance Impact

Minimal - file I/O is asynchronous and writing to disk adds <1ms overhead per request. The actual LLM call time (100-1000ms+) dominates performance.

## Security Considerations

⚠️ **Important**: The log file contains full prompts which may include:
- User input (potentially sensitive)
- System prompts (may contain business logic)
- Conversation history

**Recommendations:**
- Ensure logs directory has appropriate file permissions
- Do not commit logs to version control (already in `.gitignore`)
- Consider encrypting logs in production
- Implement log rotation to prevent disk space issues
- Review logs before sharing for debugging

## Troubleshooting

### Log file not created

Check if the directory exists and has write permissions:
```bash
ls -la logs/prompts/
```

### Docker volume not working

Verify volume mount in docker-compose:
```bash
docker-compose config | grep -A 5 volumes
```

### Logs not appearing

Check container logs for errors:
```bash
docker-compose logs python-listener | grep -i "prompt logging"
```

Should see:
```
[LLMService] Prompt logging enabled: /app/logs/prompts/llm_prompts.log
```

## Future Enhancements

Potential improvements:
- Add log rotation built into the service
- Implement configurable log retention policies
- Add structured logging (JSON format) for easier parsing
- Include token count and cost estimates in logs
- Add log compression for older entries
- Support for multiple log files (one per day/hour)
- Add filtering options (log only certain components)
- Include response content in logs (optional)
---
sidebar_position: 6
title: "📊 Progress Tracking"
---

# 📊 Progress Tracking

STELLA agents can track and display progress through todo lists and progress updates, keeping users informed about ongoing tasks.

## Todo Lists

Todo lists help structure conversations and show users what tasks the agent is working on.

### TodoItem Structure

```python
from stella_sdk import TodoItem

item = TodoItem(
    id="task-1",                    # Unique identifier
    description="Gather user info", # What the task is
    status="in_progress",           # pending | in_progress | completed
    required=True                   # Whether task is required
)
```

### Sending Todo Updates

```python
from stella_sdk import TodoItem

async def update_tasks(self):
    await self.update_todo([
        TodoItem(
            id="1",
            description="Understand user request",
            status="completed"
        ),
        TodoItem(
            id="2",
            description="Search knowledge base",
            status="in_progress"
        ),
        TodoItem(
            id="3",
            description="Provide solution",
            status="pending"
        )
    ])
```

### Status Transitions

```python
async def process_request(self, user_input: str):
    # Mark task as in progress
    await self.update_task_status("search", "in_progress")

    # Do the work
    results = await self.search(user_input)

    # Mark complete, start next
    await self.update_task_status("search", "completed")
    await self.update_task_status("respond", "in_progress")

    # Generate response
    response = await self.generate_response(results)

    await self.update_task_status("respond", "completed")
    return response
```

### Helper Class

```python
from stella_sdk import TodoList

class TaskTracker:
    def __init__(self, agent):
        self.agent = agent
        self.tasks = TodoList()

    async def add_task(self, task_id: str, description: str, required: bool = False):
        self.tasks.add(TodoItem(
            id=task_id,
            description=description,
            status="pending",
            required=required
        ))
        await self.agent.update_todo(self.tasks.items)

    async def start_task(self, task_id: str):
        self.tasks.update_status(task_id, "in_progress")
        await self.agent.update_todo(self.tasks.items)

    async def complete_task(self, task_id: str):
        self.tasks.update_status(task_id, "completed")
        await self.agent.update_todo(self.tasks.items)

    @property
    def all_required_complete(self) -> bool:
        return self.tasks.all_required_complete
```

## Progress Updates

For long-running tasks, send progress updates:

```python
async def process_large_file(self, file_data: bytes):
    total_chunks = len(file_data) // CHUNK_SIZE

    for i, chunk in enumerate(chunks(file_data, CHUNK_SIZE)):
        # Process chunk
        await self.process_chunk(chunk)

        # Send progress
        progress = ((i + 1) / total_chunks) * 100
        await self.send_progress(
            task_id="file-processing",
            progress=progress,
            message=f"Processing chunk {i + 1} of {total_chunks}"
        )
```

### Progress Message Format

```typescript
{
  type: 'progress_update',
  data: {
    task_id: string,    // Matches a todo item ID
    progress: number,   // 0-100
    message?: string    // Optional status message
  }
}
```

## Agent Status

Keep users informed of what the agent is doing:

```python
async def handle_request(self, text: str):
    # Show we're processing
    await self.send_status("thinking", "Analyzing your request...")

    # Search phase
    await self.send_status("thinking", "Searching knowledge base...")
    results = await self.search(text)

    # Generate response
    await self.send_status("thinking", "Generating response...")
    response = await self.generate_response(results)

    # Speaking
    await self.send_status("speaking")
    await self.speak(response)

    # Back to listening
    await self.send_status("listening")
```

### Status Types

| Status | Description |
|--------|-------------|
| `ready` | Agent is ready but not yet engaged |
| `listening` | Agent is listening for user input |
| `thinking` | Agent is processing/generating |
| `speaking` | Agent is speaking a response |
| `error` | An error occurred |

## Complete Example

```python
from stella_sdk import BaseAgent, TodoItem

class TaskAgent(BaseAgent):
    def __init__(self):
        super().__init__()
        self.tasks = []

    async def on_connect(self):
        # Set up initial tasks
        self.tasks = [
            TodoItem(id="greet", description="Greet user", status="in_progress"),
            TodoItem(id="gather", description="Gather requirements", status="pending"),
            TodoItem(id="process", description="Process request", status="pending"),
            TodoItem(id="respond", description="Provide solution", status="pending")
        ]
        await self.update_todo(self.tasks)

        # Complete greeting
        await self.speak("Hello! I'm here to help you today.")
        await self.complete_task("greet")

        await self.send_status("listening")

    async def on_transcript(self, text: str, is_final: bool):
        if not is_final:
            return

        # Gathering requirements
        await self.start_task("gather")
        await self.send_status("thinking", "Understanding your request...")

        # Analyze the request
        intent = await self.analyze_intent(text)
        await self.complete_task("gather")

        # Process the request
        await self.start_task("process")
        await self.send_status("thinking", "Working on your request...")

        result = await self.process_intent(intent)
        await self.complete_task("process")

        # Provide response
        await self.start_task("respond")
        await self.send_status("speaking")

        await self.speak(result)
        await self.complete_task("respond")

        await self.send_status("listening")

    async def start_task(self, task_id: str):
        for task in self.tasks:
            if task.id == task_id:
                task.status = "in_progress"
        await self.update_todo(self.tasks)

    async def complete_task(self, task_id: str):
        for task in self.tasks:
            if task.id == task_id:
                task.status = "completed"
        await self.update_todo(self.tasks)

    async def analyze_intent(self, text: str) -> dict:
        # Your intent analysis logic
        pass

    async def process_intent(self, intent: dict) -> str:
        # Your processing logic
        pass
```

## Frontend Integration

The frontend displays progress information:

```typescript
// React example
function AgentProgress({ todos, status }) {
  return (
    <div className="agent-progress">
      <div className="status">
        {status.status === 'thinking' && <Spinner />}
        {status.message}
      </div>

      <ul className="todo-list">
        {todos.map(item => (
          <li key={item.id} className={item.status}>
            {item.status === 'completed' && '✓'}
            {item.status === 'in_progress' && <Spinner small />}
            {item.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

## See Also

- [Message Types](/docs/agent-sdk/message-types)
- [Base Agent](/docs/agent-sdk/base-agent)
- [Building Custom Agents](/docs/agent-sdk/building-custom-agent)

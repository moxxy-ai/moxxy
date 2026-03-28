# Agentic Loop Implementation Patterns Across Major Frameworks

> Research compiled March 2026. Focused on concrete implementation patterns, not marketing material.

---

## Table of Contents

1. [Anthropic Claude Patterns (Claude Code + Agent SDK)](#1-anthropic-claude-patterns)
2. [OpenAI Agents SDK](#2-openai-agents-sdk)
3. [LangChain / LangGraph](#3-langchain--langgraph)
4. [OpenHands (formerly OpenDevin / All-Hands)](#4-openhands-formerly-opendevin--all-hands)
5. [CrewAI](#5-crewai)
6. [Semantic Kernel (Microsoft)](#6-semantic-kernel-microsoft)
7. [AutoGPT](#7-autogpt)
8. [OpenAI Codex CLI](#8-openai-codex-cli)
9. [Cross-Framework Comparison Matrix](#9-cross-framework-comparison-matrix)
10. [Key Takeaways for Moxxy](#10-key-takeaways-for-moxxy)

---

## 1. Anthropic Claude Patterns

**Sources:** [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents), [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents), [Claude Code Architecture (ZenML)](https://www.zenml.io/llmops-database/claude-code-agent-architecture-single-threaded-master-loop-for-autonomous-coding), [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-python), [George Sung Tracing](https://medium.com/@georgesung/tracing-claude-codes-llm-traffic-agentic-loop-sub-agents-tool-use-prompts-7796941806f5)

### Main Loop

Claude Code uses a **single-threaded master loop** (internally codenamed `nO`) with a flat list of messages. No swarms, no multiple agent personas competing for control. Anthropic explicitly chose this design for debuggability and reliability.

The canonical Anthropic agentic loop pattern is extremely simple:

```python
# Anthropic's recommended "agentic loop" pattern
def agent_loop(system_prompt, tools, messages):
    while True:
        response = client.messages.create(
            model="claude-opus-4-6",
            system=system_prompt,
            max_tokens=4096,
            tools=tools,
            messages=messages
        )

        # Append the assistant's response to messages
        messages.append({"role": "assistant", "content": response.content})

        # STOP CONDITION: no tool_use blocks means the model is done
        if response.stop_reason != "tool_use":
            return response.content  # final text output

        # Execute every tool call in the response
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                result = execute_tool(block.name, block.input)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result
                })

        # Feed tool results back as a "user" message
        messages.append({"role": "user", "content": tool_results})
```

### Stop Conditions

- **Primary:** `response.stop_reason != "tool_use"` -- when the model returns `end_turn` (plain text with no tool calls), the loop terminates.
- **Secondary:** Max iterations / timeout as external guards.
- **No explicit "done" tool** -- the model's decision to not call tools IS the stop signal.

### Nudge / Retry Mechanism

- **No built-in nudge.** Claude Code's philosophy is that if the model doesn't use tools, it's signaling it has nothing to do. The harness trusts the model.
- For long-running agents, Anthropic recommends structured artifacts (e.g., `claude-progress.txt`) so the model can understand state across sessions without nudging.

### Context Management / Compaction

The "Compressor wU2" system triggers at ~83-92% of the context window (~167K out of 200K tokens). It:
1. Clears older tool outputs first.
2. Summarizes the conversation, preserving architectural decisions, unresolved bugs, and recent file contents.
3. Keeps the 5 most recently accessed files.

Each step of the loop is treated as a fresh invocation with updated state:
- **Normalization:** Compact/summarize history when needed.
- **Inference:** Stream model response.
- **Tool Detection:** Pause and execute if tool_use blocks are present.

### Streaming

Claude Code streams responses token-by-token. The master loop pauses streaming when a `tool_use` block is detected, executes the tool, then resumes the loop. Intermediate tool results are visible in the TUI in real-time.

### Sub-Agents

Claude Code spawns sub-agents (e.g., the "codebase explorer") using lighter/cheaper models (Haiku 4.5) for scoped tasks. These are separate agent loops with their own tool sets, invoked via an internal tool. The parent agent receives the sub-agent's final output as a tool result.

### Reasoning-Chain Leakage Prevention

- Claude's API supports `thinking` blocks that are separate from `text` blocks.
- Extended thinking content is not exposed to the user by default; only the final text output is shown.
- The system prompt instructs the model on what not to expose.

---

## 2. OpenAI Agents SDK

**Sources:** [Running Agents Docs](https://openai.github.io/openai-agents-python/running_agents/), [GitHub](https://github.com/openai/openai-agents-python), [Runner Reference](https://openai.github.io/openai-agents-python/ref/run/)

### Main Loop

The OpenAI Agents SDK implements a **turn-based loop** with typed step results. The core data types driving the loop are:

```python
# Internal step result types (from run_steps.py)
@dataclass
class NextStepFinalOutput:
    output: Any

@dataclass
class NextStepHandoff:
    new_agent: Agent[Any]

@dataclass
class NextStepRunAgain:
    pass  # <-- "keep looping"

@dataclass
class NextStepInterruption:
    interruptions: list[ToolApprovalItem]  # human-in-the-loop
```

The outer loop in `Runner.run()`:

```python
# Pseudocode from run.py
async def run(starting_agent, input, max_turns, ...):
    current_agent = starting_agent
    current_turn = 0

    while current_turn < max_turns:
        current_turn += 1

        # 1. Run a single turn (call LLM + process response)
        single_step_result = await run_single_turn(
            agent=current_agent,
            input=prepared_input,
            tools=get_all_tools(current_agent),
            output_schema=get_output_schema(current_agent),
            handoffs=get_handoffs(current_agent),
            ...
        )

        # 2. Evaluate the next step
        match single_step_result.next_step:
            case NextStepFinalOutput(output):
                # Done! Run output guardrails and return.
                return RunResult(final_output=output, ...)

            case NextStepHandoff(new_agent):
                # Switch agent, reset for new turn
                current_agent = new_agent
                continue

            case NextStepRunAgain():
                # Tool calls were processed; loop again
                continue

            case NextStepInterruption(interruptions):
                # Human approval needed; pause and return state
                return build_interruption_result(...)

    # Exceeded max_turns
    raise MaxTurnsExceeded(...)
```

### Stop Conditions

1. **Final output:** Model produces text output matching `agent.output_type` AND no tool calls.
2. **Handoff:** Agent delegates to another agent (loop continues with new agent).
3. **Max turns exceeded:** Raises `MaxTurnsExceeded` exception (default = 10 turns).
4. **Interruption:** Tool requires human approval; loop pauses and returns `RunState` for resumption.

### Tool Choice Reset (Anti-Infinite-Loop)

A critical detail: after a tool call, `tool_choice` is automatically reset to `"auto"` to prevent the model from being forced to call tools indefinitely. This is configurable via `agent.reset_tool_choice`.

```python
# From tool_execution.py (conceptual)
def maybe_reset_tool_choice(agent, processed_response):
    if agent.reset_tool_choice and processed_response.has_tools_or_approvals_to_run():
        # Reset to "auto" so the model can choose to stop
        agent.model_settings.tool_choice = "auto"
```

### Streaming

`Runner.run_streamed()` returns a `RunResultStreaming` object with an async event queue. Events include:
- `RawResponsesStreamEvent` -- raw model output tokens
- `RunItemStreamEvent` -- tool call items, tool results, reasoning items
- `AgentUpdatedStreamEvent` -- when handoff occurs
- `QueueCompleteSentinel` -- stream is done

### State Machine Summary

```
            +---> NextStepFinalOutput ---> DONE (return result)
            |
START ---> [run_single_turn] ---> NextStepRunAgain ---> [loop back]
            |
            +---> NextStepHandoff ---> [switch agent, loop back]
            |
            +---> NextStepInterruption ---> PAUSED (return state for resume)
```

### Guardrails

- **Input guardrails:** Run once before the first turn (only on the first agent).
- **Output guardrails:** Run when a final output is produced.
- **Tool input/output guardrails:** Run around each tool invocation.

---

## 3. LangChain / LangGraph

**Sources:** [ReAct Agent from Scratch (Functional API)](https://langchain-ai.github.io/langgraph/how-tos/react-agent-from-scratch-functional/), [LangGraph GitHub](https://github.com/langchain-ai/langgraph), [LangChain AgentExecutor Deep Dive](https://www.aurelio.ai/learn/langchain-agent-executor)

### Main Loop (Graph-Based)

LangGraph models the agent loop as a **directed graph** with nodes and conditional edges, which is a fundamentally different model from a while-loop:

```python
# LangGraph ReAct agent -- graph-based approach
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolNode, tools_condition

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]

# 1. Define the "agent" node (calls the LLM)
def call_model(state: AgentState):
    response = model.invoke(state["messages"])
    return {"messages": [response]}

# 2. Define the "should_continue" conditional edge
def should_continue(state: AgentState):
    last_message = state["messages"][-1]
    if last_message.tool_calls:
        return "tools"       # route to tool node
    return END               # no tool calls = done

# 3. Build the graph
graph = StateGraph(AgentState)
graph.add_node("agent", call_model)
graph.add_node("tools", ToolNode(tools))
graph.set_entry_point("agent")
graph.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
graph.add_edge("tools", "agent")  # after tools, always go back to agent

app = graph.compile()
```

### Functional API (Alternative)

LangGraph also offers a simpler functional API:

```python
from langgraph.func import entrypoint, task

@task
def call_model(messages):
    return model.bind_tools(tools).invoke(messages)

@task
def call_tool(tool_call):
    tool = tools_by_name[tool_call["name"]]
    observation = tool.invoke(tool_call["args"])
    return ToolMessage(content=observation, tool_call_id=tool_call["id"])

@entrypoint()
def agent(messages):
    llm_response = call_model(messages).result()
    while llm_response.tool_calls:
        # Execute tools in parallel (returns futures)
        tool_results = [call_tool(tc) for tc in llm_response.tool_calls]
        tool_messages = [tr.result() for tr in tool_results]
        messages = messages + [llm_response] + tool_messages
        llm_response = call_model(messages).result()
    return llm_response
```

### Stop Conditions

1. **No tool calls:** The `should_continue` / `tools_condition` check. If the last message has no `tool_calls`, route to `END`.
2. **Recursion limit:** `recursion_limit` config parameter (default varies). A `GraphRecursionError` is raised if exceeded.
3. **`RemainingSteps` managed value:** Allows the agent to check how many steps remain and adjust behavior.

### Nudge / Retry

- **No built-in nudge.** If the model returns text without tool calls, the graph terminates.
- However, because it's a graph, you can add custom nodes that inject "retry" logic or append a nudge message before routing back to the agent node.

### Agent Scratchpad

The legacy `AgentExecutor` (pre-LangGraph) used an `agent_scratchpad` -- a list of messages with alternating `ai` and `tool` roles that accumulates the reasoning trace. In LangGraph, this is replaced by the state's `messages` list.

### Streaming

LangGraph supports streaming via `.stream()` and `.astream()` on compiled graphs. Events include:
- Node outputs (after each node executes)
- Token-by-token streaming from the LLM node

### Key Architectural Difference

LangGraph is a **state-machine / graph executor**, not a while-loop. The loop is implicit in the graph's cycle (tools -> agent -> conditional -> tools | END). This makes it composable: you can add human-in-the-loop nodes, checkpoint/resume, branch, etc.

---

## 4. OpenHands (formerly OpenDevin / All-Hands)

**Sources:** [OpenHands Docs](https://docs.all-hands.dev/), [Stuck Detector Docs](https://docs.openhands.dev/sdk/guides/agent-stuck-detector), [Agent Controller Source (Legacy V0)](https://github.com/All-Hands-AI/OpenHands), [Software Agent SDK V1](https://github.com/OpenHands/software-agent-sdk)

### Main Loop

OpenHands uses an **event-stream architecture** with an action-observation loop. The `AgentController` is the orchestrator:

```python
# Pseudocode from agent_controller.py (Legacy V0, but patterns carry forward)
class AgentController:
    async def _step(self):
        """Single step of the agent. Called by event system."""
        if self.get_agent_state() != AgentState.RUNNING:
            return

        # Check budget and iteration limits
        if self.state.iteration >= self.max_iterations:
            raise RuntimeError("Agent reached maximum iteration")

        if self.state.metrics.accumulated_cost > self.max_budget_per_task:
            raise RuntimeError("Agent reached maximum budget")

        # Check if agent is stuck (loop detection)
        if self.agent.config.enable_stuck_detection and self._is_stuck():
            raise AgentStuckInLoopError("Agent got stuck in a loop")

        # Get next action from the agent (calls LLM internally)
        action = self.agent.step(self.state)

        # Dispatch action to execution environment
        if isinstance(action, AgentFinishAction):
            await self.set_agent_state_to(AgentState.FINISHED)
        elif isinstance(action, AgentDelegateAction):
            await self._start_delegate(action)
        elif isinstance(action, CmdRunAction):
            # Execute in sandbox, produce observation
            ...
        elif isinstance(action, FileEditAction):
            ...
        # ... other action types

        # Observation flows back via event stream -> triggers next _step()
```

### Stop Conditions

1. **`AgentFinishAction`:** Agent explicitly signals completion.
2. **`AgentRejectAction`:** Agent rejects the task.
3. **Max iterations:** Hard cap on number of steps.
4. **Max budget:** Cost-based limit (USD per task).
5. **Stuck detection:** Automatic detection of unproductive loops.
6. **User stop:** Manual cancellation via UI.

### Stuck Detector (Unique Feature)

OpenHands has a dedicated `StuckDetector` class that identifies when an agent enters unproductive patterns:

```python
# Patterns detected by StuckDetector:
# 1. Agent monologues: 3+ consecutive messages without actions
# 2. Alternating action patterns: 6+ repeated cycles of the same action
# 3. Repeated identical actions: Same command/edit repeated multiple times
# 4. Context window errors: Model keeps exceeding context
```

When stuck is detected:
- Agent enters `ERROR` state.
- A `LoopDetectionObservation` is emitted.
- Recovery options: restart from before loop, provide human guidance, or stop.

### Event-Driven Architecture

Unlike a simple while-loop, OpenHands is fully event-driven:
- `ActionEvent` subclasses represent tool calls (CmdRun, FileEdit, BrowseURL, etc.)
- `ObservationEvent` subclasses represent tool results
- Events are published to an `EventStream`
- The `AgentController` subscribes to the event stream and calls `_step()` when triggered

### Agent Delegation

The controller supports **hierarchical agent delegation**: a parent agent can spawn a child agent (`AgentDelegateAction`) with its own event stream. The parent waits for the delegate to finish/error/reject.

### Confirmation Mode

When `confirmation_mode=True`, certain actions pause the agent in `AWAITING_USER_CONFIRMATION` state. The user must approve or reject before the agent continues. This is a structured human-in-the-loop mechanism.

---

## 5. CrewAI

**Sources:** [CrewAI Docs - Agents](https://docs.crewai.com/en/concepts/agents), [CrewAI GitHub](https://github.com/crewAIInc/crewAI), [Agent Executor (DeepWiki)](https://deepwiki.com/lymanzhang/crewAI/5.1-cli-commands-reference)

### Main Loop

The `CrewAgentExecutor` manages the core iteration loop:

```python
# Pseudocode from crew_agent_executor.py
class CrewAgentExecutor(CrewAgentExecutorMixin):
    def _invoke_loop(self) -> AgentFinish:
        """Core loop: call LLM, execute tools, repeat."""
        iterations = 0

        while True:
            iterations += 1

            # Check if max iterations reached
            if self._should_force_answer(iterations):
                return self.handle_max_iterations_exceeded()

            # Call the LLM with current messages
            response = self.llm.call(self.messages)

            # Parse response into AgentAction or AgentFinish
            parsed = self.format_answer(response)

            if isinstance(parsed, AgentFinish):
                return parsed  # <-- STOP: model produced final answer

            if isinstance(parsed, AgentAction):
                # Execute the tool
                tool_result = self.execute_tool(parsed.tool, parsed.tool_input)

                # Append tool result as an assistant message
                self.messages.append({
                    "role": "assistant",
                    "content": f"Tool result: {tool_result}"
                })

                # Continue loop...

        # Should never reach here due to max_iter guard
```

### Stop Conditions

1. **`AgentFinish`:** Model returns a parseable final answer (typically in a structured format like `Final Answer: ...`).
2. **Max iterations:** Default = 25. When reached, triggers the force-answer mechanism.
3. **Human input:** If `ask_for_human_input=True`, pauses for user feedback after the loop.

### Force Final Answer Mechanism (Nudge)

This is CrewAI's most distinctive pattern -- a built-in **nudge**:

```python
# From agent_utils.py -- handle_max_iterations_exceeded()
def handle_max_iterations_exceeded(self):
    """Force the agent to produce a final answer."""

    # Append a forcing message to the conversation
    force_message = (
        "You must provide your BEST FINAL ANSWER NOW. "
        "You have reached the maximum number of iterations. "
        "Provide your final answer using the format: Final Answer: <your answer>"
    )
    self.messages.append({"role": "user", "content": force_message})

    # Make ONE more LLM call with the forcing message
    response = self.llm.call(self.messages)
    parsed = self.format_answer(response)

    if isinstance(parsed, AgentFinish):
        return parsed
    else:
        # If STILL not a final answer, convert AgentAction text to AgentFinish
        return AgentFinish(output=parsed.text)
```

**Known bug:** The force answer can sometimes be overwritten by subsequent LLM calls if the loop doesn't properly terminate.

### Message Management

CrewAI maintains a flat `messages` list where:
- System prompt and task description are formatted as initial user/system messages.
- LLM responses (including tool calls) are appended as assistant messages.
- Tool results are appended as assistant messages (not as separate tool messages).

### Multi-Agent Orchestration

CrewAI's orchestration model is different from single-agent loops:
- A `Crew` contains multiple `Agent`s assigned to `Task`s.
- Execution modes: **Sequential** (agents execute tasks in order) or **Hierarchical** (manager agent delegates).
- Each agent has its own `CrewAgentExecutor` with its own loop.
- Output of one task feeds as input to the next task.

---

## 6. Semantic Kernel (Microsoft)

**Sources:** [Function Calling Docs](https://learn.microsoft.com/en-us/semantic-kernel/concepts/ai-services/chat-completion/function-calling/), [Function Invocation Docs](https://learn.microsoft.com/en-us/semantic-kernel/concepts/ai-services/chat-completion/function-calling/function-invocation), [SK Agent Framework](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/), [Planning with SK](https://devblogs.microsoft.com/semantic-kernel/planning-with-semantic-kernel-using-automatic-function-calling/)

### Main Loop

Semantic Kernel implements the agent loop as **automatic function invocation** within the chat completion service. The loop is hidden inside the `ChatCompletionService`:

```csharp
// Pseudocode of Semantic Kernel's auto-invoke loop (C#)
public async Task<ChatMessageContent> GetChatMessageContentAsync(
    ChatHistory chatHistory,
    PromptExecutionSettings settings,
    Kernel kernel)
{
    int iteration = 0;
    int maxIterations = settings.FunctionChoiceBehavior.MaximumAutoInvokeAttempts; // default ~5

    while (iteration < maxIterations)
    {
        iteration++;

        // 1. Call the LLM
        var response = await this.InnerClient.GetChatCompletionAsync(
            chatHistory,
            toolDefinitions: GetToolDefinitions(kernel),
            toolChoice: settings.ToolChoice  // "auto", "required", or "none"
        );

        // 2. Add assistant response to chat history
        chatHistory.Add(response);

        // 3. Check for function calls
        if (!response.HasFunctionCalls)
        {
            return response;  // STOP: model returned text, no function calls
        }

        // 4. Execute each function call
        foreach (var functionCall in response.FunctionCalls)
        {
            // Fire AutoFunctionInvocationFilter (pre-invocation hook)
            var filterContext = new AutoFunctionInvocationContext(kernel, functionCall);
            await InvokeFilters(filterContext);

            if (filterContext.Terminate)
            {
                return filterContext.Result;  // Filter says stop
            }

            // Invoke the function
            var result = await kernel.InvokeAsync(functionCall.FunctionName, functionCall.Arguments);

            // Add result to chat history
            chatHistory.AddToolMessage(functionCall.Id, result.ToString());
        }
        // Loop back to call LLM again with updated history
    }

    // Max iterations reached -- return last response as-is
    return chatHistory.Last();
}
```

### Stop Conditions

1. **No function calls:** Model returns a plain text response.
2. **Max auto-invoke attempts:** `maximum_auto_invoke_attempts` (Python) / `MaximumAutoInvokeAttempts` (C#). Default ~5.
3. **Filter termination:** `AutoFunctionInvocationFilter` can signal `Terminate = true` to break out.
4. **Manual mode:** If `auto_invoke=False`, the loop does NOT run; tool calls are returned to the caller for manual execution.

### FunctionChoiceBehavior

Three modes:
- `FunctionChoiceBehavior.Auto()` -- Model decides when to call functions. Default.
- `FunctionChoiceBehavior.Required()` -- Model must call at least one function (dangerous for loops).
- `FunctionChoiceBehavior.None()` -- No function calling.

```python
# Python configuration
settings = PromptExecutionSettings(
    function_choice_behavior=FunctionChoiceBehavior.Auto(
        auto_invoke=True,
        maximum_auto_invoke_attempts=10,
        filters={"included_functions": ["search", "calculate"]}
    )
)
```

### Agent Framework (Higher Level)

The SK Agent Framework builds on top of the function calling loop:
- `ChatCompletionAgent` -- wraps the auto-invoke loop for single-agent scenarios.
- `AgentGroupChat` -- multi-agent orchestration with turn-taking strategies.
- Agents share a `ChatHistory` and take turns via strategies (sequential, selection-based).

### Streaming

SK supports streaming through `GetStreamingChatMessageContentAsync`. Function calls are accumulated during streaming and executed after the full response is received.

### Process Framework

For complex multi-step workflows, SK offers a separate **Process Framework** with:
- Steps (units of work)
- Events (communication between steps)
- Maps (sub-processes)
- State persistence across process restarts

---

## 7. AutoGPT

**Sources:** [AutoGPT GitHub](https://github.com/Significant-Gravitas/AutoGPT), [Forge Tutorial (Medium)](https://aiedge.medium.com/autogpt-forge-crafting-intelligent-agent-logic-bc5197b14cb4), [AI Agent Architecture Breakdown](https://medium.com/@georgesung/ai-agents-autogpt-architecture-breakdown-ba37d60db944)

### Main Loop

AutoGPT evolved from a simple prompt-chaining loop to the Forge framework. The core pattern:

```python
# Pseudocode of AutoGPT's agent step mechanism
class Agent:
    async def execute_step(self, task: Task, step: Step) -> StepResult:
        """Execute a single step of the agent loop."""

        # 1. Build the prompt with:
        #    - System instructions
        #    - Task description
        #    - Relevant memories from past steps
        #    - Available commands/tools
        #    - "GENERATE NEXT COMMAND JSON" instruction
        prompt = self.prompt_engine.build(
            task=task,
            memories=self.memory.search(task.context),
            commands=self.available_commands
        )

        # 2. Call the LLM
        response = await chat_completion_request(
            messages=[{"role": "system", "content": prompt}]
        )

        # 3. Parse the JSON command from response
        command = parse_command(response)

        # 4. Execute the command
        if command.name == "task_complete":
            return StepResult(is_last=True, output=command.args["reason"])

        result = await self.execute_command(command)

        # 5. Store result in memory
        self.memory.store(step_result=result)

        return StepResult(is_last=False, output=result)
```

### Stop Conditions

1. **`task_complete` command:** The model issues a `task_complete` or `shutdown` command.
2. **Max steps:** Configurable limit on number of steps.
3. **Budget limit:** Token/cost-based budget per task.
4. **User interrupt:** Manual stop from the UI.

### Self-Prompting / Criticism Loop

AutoGPT's original design included a **built-in criticism loop**:
- After each action, the model generates self-criticism of its approach.
- The criticism is appended to context for the next step.
- This acts as an implicit "retry/improve" nudge without external intervention.

```
THOUGHTS: I should check if the file exists before editing.
REASONING: Previous attempt failed because the file didn't exist.
CRITICISM: I should have verified the file path first.
NEXT COMMAND: list_files(directory="./src")
```

### Memory System

AutoGPT uses a memory system to persist information across steps:
- **Episodic memory:** Records of past steps and their outcomes.
- **Semantic memory:** Extracted knowledge and facts.
- Memory is queried at each step to inform the prompt.

### Agent Protocol

AutoGPT adopted the [AI Engineer Foundation's Agent Protocol](https://agentprotocol.ai/) as a standard interface:
- `POST /tasks` -- create a task
- `POST /tasks/{task_id}/steps` -- execute a step
- `GET /tasks/{task_id}/steps/{step_id}` -- get step result

Each "step" is one iteration of the loop, exposed as an API call.

---

## 8. OpenAI Codex CLI

**Sources:** [Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/), [Codex GitHub](https://github.com/openai/codex), [How Codex is Built](https://newsletter.pragmaticengineer.com/p/how-codex-is-built)

### Main Loop

Codex CLI uses a **two-level loop** architecture:

```
Outer Loop (conversation turns):
  User Input --> [Inner Loop] --> Assistant Message --> User Input --> ...

Inner Loop (single turn):
  Prompt --> Model Inference --> [Tool Call? Execute & append] --> ... --> Done Event
```

```typescript
// Pseudocode of Codex CLI agent loop (TypeScript)
async function agentTurn(conversation: Message[]): Promise<AssistantMessage> {
    while (true) {
        // Call the model via Responses API
        const response = await responsesAPI.create({
            model: "codex-*",
            input: conversation,
            tools: availableTools,
        });

        // Process each output item
        for (const item of response.output) {
            if (item.type === "reasoning") {
                // Reasoning/thinking -- append but don't show to user
                conversation.push(item);
            } else if (item.type === "tool_call") {
                // Execute tool (file write, shell command, etc.)
                const result = await executeTool(item);
                conversation.push(item);       // the tool call
                conversation.push(result);     // the tool result
            } else if (item.type === "message") {
                // Done event -- this is the assistant's response
                return item;
            }
        }
        // If we processed tool calls but no "done" message, loop again
    }
}
```

### Stop Conditions

1. **Done event:** Model emits a message-type response (assistant message), signaling end of turn.
2. **Max inner iterations:** Guard against infinite tool-calling loops.
3. **User interrupt:** Ctrl+C or cancel from UI.

### Key Design Insight

Codex CLI distinguishes between:
- The **primary output** (code changes on disk -- file edits, shell commands executed).
- The **assistant message** (summary like "I added the architecture.md you asked for").

The assistant message always comes at the end, but the real work happened during tool calls.

### Harness Architecture

The "harness" is the shared core between Codex CLI, Codex Cloud, and Codex VS Code extension. It provides:
- Agent loop execution
- Tool management
- Sandbox/execution environment
- Human oversight (approval for file writes, command execution)

---

## 9. Cross-Framework Comparison Matrix

| Feature | Anthropic/Claude | OpenAI Agents SDK | LangGraph | OpenHands | CrewAI | Semantic Kernel | AutoGPT | Codex CLI |
|---|---|---|---|---|---|---|---|---|
| **Loop Model** | while-loop | turn-based with typed steps | State graph | Event-driven | while-loop | Hidden in ChatCompletion | Step-based API | Two-level (outer/inner) |
| **Stop: No tools** | `stop_reason != "tool_use"` | `NextStepFinalOutput` | `tools_condition -> END` | `AgentFinishAction` | `AgentFinish` parsed | No function calls in response | `task_complete` command | Done event (message type) |
| **Stop: Max iter** | External guard | `MaxTurnsExceeded` exception | `recursion_limit` | `max_iterations` | `max_iter` (default 25) | `maximum_auto_invoke_attempts` | Configurable max steps | Inner loop guard |
| **Nudge/Force** | None (trusts model) | None (reset tool_choice) | None (add custom node) | `LoopRecoveryAction` | `force_final_answer` message | Filter can override | Self-criticism loop | None |
| **Stuck Detection** | None built-in | None built-in | None built-in | `StuckDetector` (monologues, patterns) | None built-in | None built-in | None built-in | None built-in |
| **Handoff** | Sub-agent via tool | `NextStepHandoff` (first-class) | Graph routing | `AgentDelegateAction` | Crew task chaining | `AgentGroupChat` | N/A | N/A |
| **Human-in-Loop** | None built-in | `NextStepInterruption` | Custom node | `AWAITING_USER_CONFIRMATION` | `ask_for_human_input` | `AutoFunctionInvocationFilter` | User approval step | Approval for writes |
| **Streaming** | Token-level, pause on tool_use | Event queue (typed events) | Node-level + token-level | Event stream | None standard | Token-level streaming | N/A | Token-level |
| **Context Mgmt** | Compaction at ~85% | None built-in | Checkpointing | Event stream + replay | Message list only | Chat history | Episodic + semantic memory | Conversation history |
| **Tool Choice Reset** | N/A (uses stop_reason) | Auto-reset to "auto" after tool | N/A | N/A | N/A | Via FunctionChoiceBehavior | N/A | N/A |
| **Reasoning Privacy** | Thinking blocks separate | Reasoning items (configurable) | N/A | N/A | N/A | N/A | Thoughts in prompt only | Reasoning items |

---

## 10. Key Takeaways for Moxxy

### Universal Patterns

1. **The core loop is the same everywhere:** Call LLM -> check for tool calls -> execute tools -> append results -> repeat. Every framework implements this, just with different wrapping (while-loop, graph, event stream).

2. **"No tool calls" is the universal stop signal.** Every framework treats the absence of tool calls as the model saying "I'm done." The only variation is HOW this is detected (stop_reason, typed step result, conditional edge, etc.).

3. **Max iterations is always present** as a safety guard, with defaults ranging from 5 (Semantic Kernel) to 25 (CrewAI) to 100,000 (Moxxy). The real guard is usually a timeout.

4. **Tool choice reset is underappreciated.** OpenAI Agents SDK's auto-reset of `tool_choice` to `"auto"` after tool calls is a simple but effective anti-infinite-loop mechanism that most frameworks don't implement.

### Differentiated Patterns Worth Considering

5. **Typed step results (OpenAI SDK):** Using `NextStepFinalOutput | NextStepHandoff | NextStepRunAgain | NextStepInterruption` as an enum makes the loop logic explicit and exhaustive. This is cleaner than checking `isinstance(parsed, AgentFinish)`.

6. **Stuck detection (OpenHands):** Detecting agent monologues, repeated actions, and alternating patterns is valuable for long-running agents. Moxxy could implement this as a middleware/observer on the agentic loop.

7. **Force-final-answer (CrewAI):** When max iterations are reached, injecting a "you MUST answer now" message and making one more LLM call is practical, even though it's hacky. It prevents the agent from failing silently.

8. **Graph-based composition (LangGraph):** Modeling the loop as a state graph makes it composable (add human-in-the-loop, branching, persistence) but adds complexity. For Moxxy's single-agent loops, a while-loop is simpler.

9. **Event-stream architecture (OpenHands):** Full event sourcing gives you replay, audit trails, and recovery for free, but is complex to implement. Moxxy's existing `EventBus` is a lighter version of this pattern.

10. **Compaction/context management (Claude Code):** Automatic context compaction when approaching the window limit is essential for long-running agents. Moxxy should consider implementing a similar mechanism that: (a) detects when context is nearing the limit, (b) summarizes older messages while preserving recent ones and key decisions, (c) replaces the message history with the compressed version.

### Anti-Patterns to Avoid

11. **Don't hide the loop.** Semantic Kernel's approach of hiding the tool-call loop inside `ChatCompletionService` makes it hard to add custom logic (logging, metrics, human approval) between iterations.

12. **Don't rely solely on max_iter.** CrewAI's bugs with `force_final_answer` being overwritten show that max_iter alone isn't enough. Combine with timeout AND stuck detection.

13. **Don't conflate tool results with assistant messages.** CrewAI appends tool results as assistant messages, which can confuse the model. The OpenAI tool_call_id round-tripping protocol (which Moxxy already uses) is the correct approach.

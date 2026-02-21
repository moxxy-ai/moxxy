# `delegate_task` Tool

## Description
This tool allows you to dispatch a sub-task or prompt to another AI agent in the Swarm. It will trigger that agent's cognitive loop, wait for it to finish its research and tool usage, and then return its final written response to you.

## When to use
- When you are given a large, multi-step problem, and you want to parallelize or offload a specific chunk of the problem to another specialized agent.
- DO NOT use this to talk to yourself. Only use it to talk to other deployed agents.

## Parameters
1. **Target Agent Name** (String, Required): The exact name of the agent you want to delegate to (e.g., `default`, `coder`).
2. **Prompt** (String, Required): The detailed instructions you want the other agent to execute on your behalf.

## Example Usage
<invoke name="delegate_task">researcher|Find the latest news about Rust language updates and return a summary.</invoke>

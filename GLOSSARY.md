# Moxxy

The language of the moxxy product: what a person talks to, what it works on,
and what it keeps. [PRODUCT.md](PRODUCT.md) decides which of these terms the
default experience shows.

## Language

### Who

**Agent**:
A someone the person delegates work to. It has a name, an avatar and a remit, it lives in one workspace, and it has one conversation.
_Avoid_: Bot, assistant, worker

**Workspace**:
A place for work: its files, a description of what it is about, and the agents working in it.
_Avoid_: Project, desk, folder

**Home**:
The workspace every person gets automatically, for work that belongs to no project.
_Avoid_: Default workspace, unassigned, personal folder

**Conversation**:
The single, lasting exchange between a person and one agent. It is never restarted or replaced.
_Avoid_: Run, session, thread, chat

**Bot**:
An agent's account on a channel, such as its Telegram account.
_Avoid_: Agent

### Work

**Task**:
One item of work the agent has agreed to do, visible to the person as a line on the task list. It has a status and no process of its own.
_Avoid_: Run, job, to-do, step

**Task list**:
The open tasks of one conversation. It closes when every task is done or cancelled, and the next request starts a new one.
_Avoid_: Plan, board, queue

**Job**:
A command that keeps running in the background while the agent does other work.
_Avoid_: Task, background task

**Subagent**:
A short-lived helper the agent starts for one piece of work and that reports back to it.
_Avoid_: Worker, bot, task

### Talking

**Inbox**:
Where messages addressed to the agent wait until it reads them. A message from a person holds the agent's not-yet-started actions; an automatic event does not.
_Avoid_: Queue, mailbox

**Channel**:
A surface through which a person reaches the agent, such as the desktop app, the terminal, or Telegram.
_Avoid_: Group, room

**Group**:
A shared conversation inside one workspace with more than one of its agents in it.
_Avoid_: Channel, room

### Remembering

**History**:
The dated record of what happened in a workspace's conversations, derived automatically from what was said and done. It never leaves its workspace.
_Avoid_: Memory, archive, log

**Memory**:
Facts and preferences saved on purpose so they apply in every later conversation. It carries no record of when things happened.
_Avoid_: History, knowledge base

import { describe, expect, it } from 'vitest';
import { FakeProvider, textReply } from '@moxxy/testing';
import { buildSystemPrompt, draftWorkflow } from './draft.js';

const MULTI_STEP_DRAFT = `\`\`\`yaml
name: image-report-email
description: Generate an image from a brief, write a report, and email it.
enabled: true
inputs:
  brief:
    description: What image to generate.
  recipient:
    default: ""
    description: Email address for the final report.
steps:
  - id: generate_image
    label: Generate image
    prompt: |
      Generate the image from the brief:
      {{ inputs.brief }}
  - id: write_report
    needs: [generate_image]
    label: Write report
    prompt: |
      Write a report about the image.
      {{ steps.generate_image.output }}
  - id: send_email
    needs: [write_report]
    label: Send report
    tool: gmail_send
    args:
      to: "{{ inputs.recipient }}"
      subject: "Image workflow report"
      body: "{{ steps.write_report.output }}"
\`\`\``;

describe('draftWorkflow', () => {
  it('buildSystemPrompt lists skills and tools with descriptions', () => {
    const prompt = buildSystemPrompt({
      availableSkills: [{ name: 'web-research', description: 'Search the web' }],
      availableTools: [{ name: 'gmail_send', description: 'Send email via Gmail' }],
    });
    expect(prompt).toContain('web-research');
    expect(prompt).toContain('Search the web');
    expect(prompt).toContain('gmail_send');
    expect(prompt).toContain('at least 4 steps');
    expect(prompt).toContain('<< skill-name >>');
    // awaitInput (human-in-the-loop) is shippable again — the prompt teaches the
    // mid-run pause flow and includes a worked example.
    expect(prompt).toContain('awaitInput');
    expect(prompt).toContain('awaitInput: true');
    expect(prompt).toMatch(/only valid on prompt\/skill|only allowed on prompt or skill|prompt or skill step/i);
  });

  it('teaches the loop node with a worked example', () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain('loop:');
    expect(prompt).toContain('maxIterations');
    expect(prompt).toMatch(/iterate while|refine-until-good|retry up to/i);
  });

  it('parses a multi-step drafted workflow from provider output', async () => {
    const provider = new FakeProvider({
      script: [textReply(MULTI_STEP_DRAFT)],
    });
    const drafted = await draftWorkflow(
      provider,
      'fake-model',
      'zapytaj o zdjęcie, wygeneruj, raport, wyślij maila',
      AbortSignal.timeout(5000),
      {
        availableSkills: [{ name: 'web-research', description: 'Research' }],
        availableTools: [{ name: 'gmail_send', description: 'Send mail' }],
      },
    );
    expect(drafted.parse.ok).toBe(true);
    expect(drafted.parse.errors).toEqual([]);
    expect(drafted.parse.workflow?.name).toBe('image-report-email');
    expect(drafted.parse.workflow?.steps).toHaveLength(3);
    expect(drafted.parse.workflow?.inputs?.recipient).toBeDefined();
    expect(drafted.parse.workflow?.steps[2]?.tool).toBe('gmail_send');
    expect(provider.received[0]?.maxTokens).toBe(4096);
    expect(drafted.truncated).toBe(false);
  });

  it('clamps the draft budget to the model maxOutputTokens ceiling', async () => {
    const provider = new FakeProvider({
      models: [{ id: 'tiny-model', contextWindow: 8000, maxOutputTokens: 2000, supportsTools: true, supportsStreaming: true }],
      script: [textReply(MULTI_STEP_DRAFT)],
    });
    await draftWorkflow(provider, 'tiny-model', 'anything', AbortSignal.timeout(5000));
    expect(provider.received[0]?.maxTokens).toBe(2000);
  });

  it('flags a max_tokens stop as truncated', async () => {
    const provider = new FakeProvider({
      script: [
        [
          { type: 'message_start', model: 'fake' },
          { type: 'text_delta', delta: 'name: cut-off\ndescription: partial draft\nsteps:\n  - id: one\n    lab' },
          { type: 'message_end', stopReason: 'max_tokens' },
        ],
      ],
    });
    const drafted = await draftWorkflow(provider, 'fake-model', 'anything', AbortSignal.timeout(5000));
    expect(drafted.truncated).toBe(true);
    expect(drafted.parse.ok).toBe(false);
  });
});

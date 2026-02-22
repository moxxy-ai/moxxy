Create a new React component for the moxxy web dashboard.

Component request: $ARGUMENTS

## Instructions

### 1. Understand the Request

Parse the component name (PascalCase, e.g., `AnalyticsPanel`) and description. Dashboard components are typically panels that display data for the active agent.

### 2. Read Reference Materials

Read these files to understand the patterns:

- `frontend/src/components/SchedulesPanel.tsx` -- Clean panel example (CRUD with API calls)
- `frontend/src/components/WebhooksPanel.tsx` -- Full-featured panel example
- `frontend/src/types/index.ts` -- TypeScript interfaces and `TabId` union type
- `frontend/src/App.tsx` -- Component registration, state management, prop passing
- `frontend/src/components/Sidebar.tsx` -- Tab navigation entries

### 3. Create the Component

Create `frontend/src/components/<Name>.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { RefreshCw, Plus, Trash2 } from 'lucide-react'; // Pick relevant icons

interface Props {
  apiBase: string;
  agents: string[];
  activeAgent: string;
  setActiveAgent: (agent: string) => void;
}

export default function <Name>({ apiBase, agents, activeAgent, setActiveAgent }: Props) {
  const [items, setItems] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchItems = async () => {
    if (!activeAgent) return;
    try {
      const res = await fetch(`${apiBase}/agents/${activeAgent}/<endpoint>`);
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('Failed to fetch items:', err);
    }
  };

  useEffect(() => {
    fetchItems();
  }, [activeAgent]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-[#00aaff] tracking-widest uppercase text-sm font-semibold">
          <Name>
        </h2>
        <button
          onClick={fetchItems}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Agent Selector */}
      <div>
        <label className="block text-xs text-gray-500 uppercase tracking-wider mb-1">Agent</label>
        <select
          value={activeAgent}
          onChange={(e) => setActiveAgent(e.target.value)}
          className="w-full bg-[#0a1628] border border-[#1e304f] rounded px-3 py-2 text-sm text-gray-300"
        >
          {agents.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Status Message */}
      {status && (
        <div className={`text-sm ${status.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>
          {status}
        </div>
      )}

      {/* Content */}
      <div className="bg-[#111927]/90 border border-[#1e304f] rounded-lg p-4">
        {items.length === 0 ? (
          <p className="text-gray-500 text-sm">No items found.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-[#0a1628] rounded border border-[#1e304f]">
                <span className="text-gray-300 text-sm">{JSON.stringify(item)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Styling conventions (dark theme):**
- Background panels: `bg-[#111927]/90`
- Inner cards: `bg-[#0a1628]`
- Borders: `border border-[#1e304f]`
- Headers: `text-[#00aaff]`, `tracking-widest`, `uppercase`, `text-sm`, `font-semibold`
- Body text: `text-gray-300`
- Muted text: `text-gray-500`
- Success: `text-emerald-400`
- Warning: `text-amber-400`
- Error: `text-red-400`
- Inputs: `bg-[#0a1628] border border-[#1e304f] rounded px-3 py-2 text-sm text-gray-300`
- Buttons: `bg-[#00aaff]/20 hover:bg-[#00aaff]/30 text-[#00aaff] rounded px-3 py-2`

### 4. Register in App.tsx

**a. Add import** at the top of `frontend/src/App.tsx`:
```tsx
import <Name> from './components/<Name>';
```

**b. Add any state variables** if needed (useState hooks near the top of App component).

**c. Add a case** in the `renderContent()` switch statement (or equivalent conditional rendering):
```tsx
case '<tabId>':
  return <<Name>
    apiBase={apiBase}
    agents={agents}
    activeAgent={activeAgent}
    setActiveAgent={setActiveAgent}
  />;
```

### 5. Add Tab Navigation

**a. Add `TabId` variant** in `frontend/src/types/index.ts`:
Find the `TabId` type union and add your new tab ID.

**b. Add sidebar entry** in `frontend/src/components/Sidebar.tsx`:
Add a new entry in the navigation items array with an appropriate icon from `lucide-react` and label.

### 6. Add TypeScript Types (if needed)

If the component works with structured data from the API, add type interfaces in `frontend/src/types/index.ts`:

```typescript
export interface YourItemType {
  name: string;
  // ...
}
```

### 7. Build and Verify

Run `cd frontend && npm run build` to verify the frontend compiles without TypeScript errors.

Common issues:
- Missing icon imports from `lucide-react`
- TypeScript type mismatches in props
- Missing `TabId` variant causing switch statement gaps
- Missing import in `App.tsx`

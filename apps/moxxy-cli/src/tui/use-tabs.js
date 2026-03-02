import { useState, useCallback } from 'react';

/**
 * Hook for managing multiple agent tabs.
 * @param {string} initialAgentId - The first agent's ID
 * @returns {object} Tab management functions and state
 */
export function useTabs(initialAgentId) {
  const [tabs, setTabs] = useState([
    { id: 0, agentId: initialAgentId, label: `Agent ${initialAgentId?.slice(0, 8) || '?'}` }
  ]);
  const [activeIndex, setActiveIndex] = useState(0);

  const addTab = useCallback((agentId) => {
    setTabs(prev => {
      const id = prev.length > 0 ? Math.max(...prev.map(t => t.id)) + 1 : 0;
      return [...prev, { id, agentId, label: `Agent ${agentId?.slice(0, 8) || '?'}` }];
    });
    setActiveIndex(prev => {
      // We need the new length; since setTabs runs first in the same render,
      // we read from current closure. Use functional update for safety.
      return prev + 1; // will be corrected by switchTab bounds
    });
  }, []);

  const closeTab = useCallback((index) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev; // can't close last tab
      return prev.filter((_, i) => i !== index);
    });
    setActiveIndex(prev => {
      // Adjust active index after removal
      if (index < prev) return prev - 1;
      if (index === prev) return Math.max(0, prev - 1);
      return prev;
    });
  }, []);

  const switchTab = useCallback((index) => {
    setActiveIndex(prev => {
      // We don't have tabs.length in this closure reliably, but
      // React will re-render with the correct value. Just set directly.
      return Math.max(0, index);
    });
  }, []);

  const switchLeft = useCallback(() => {
    setActiveIndex(prev => prev > 0 ? prev - 1 : prev);
  }, []);

  const switchRight = useCallback(() => {
    setActiveIndex(prev => prev + 1);
  }, []);

  // Clamp activeIndex to valid range
  const clampedIndex = Math.max(0, Math.min(activeIndex, tabs.length - 1));

  return {
    tabs,
    activeIndex: clampedIndex,
    activeTab: tabs[clampedIndex] || tabs[0],
    addTab,
    closeTab,
    switchTab,
    switchLeft,
    switchRight,
  };
}

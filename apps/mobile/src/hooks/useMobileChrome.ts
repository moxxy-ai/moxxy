import { useCallback, useState } from 'react';

export function useMobileChrome() {
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setMenuOpen((open) => !open);
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  return {
    menuOpen,
    toggleMenu,
    closeMenu,
  };
}

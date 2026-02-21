import { useState, useEffect } from 'react';

export function useApi() {
  const [apiBase, setApiBase] = useState<string>('');

  useEffect(() => {
    fetch('/config.json')
      .then(res => res.json())
      .then(data => {
        if (data.api_base) setApiBase(data.api_base);
      })
      .catch(() => {
        setApiBase('http://127.0.0.1:17890/api');
      });
  }, []);

  return { apiBase, setApiBase };
}

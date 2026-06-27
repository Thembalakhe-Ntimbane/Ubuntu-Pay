const KEY = 'openremit_token';

export const getToken    = (): string | null => localStorage.getItem(KEY);
export const setToken    = (t: string): void  => { localStorage.setItem(KEY, t); };
export const clearToken  = (): void           => { localStorage.removeItem(KEY); };
export const isLoggedIn  = (): boolean        => !!getToken();

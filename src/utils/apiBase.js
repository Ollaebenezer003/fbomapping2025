// Deployed builds (Preview and Production) call the API on their own origin,
// so a Preview deployment never talks to the Production API.
// VITE_API_URL is honoured only by the local Vite dev server.
export const API_BASE = import.meta.env.DEV ? (import.meta.env.VITE_API_URL ?? "") : "";

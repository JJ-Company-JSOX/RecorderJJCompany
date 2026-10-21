const env = import.meta.env;
const configured = (value: string | undefined) =>
	Boolean(value?.trim() && !value.includes("YOUR_"));

/**
 * Recordly accounts are optional and off unless a build turns them on with
 * VITE_RECORDLY_ACCOUNTS=1 and a Supabase project (VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY). Recording and editing never need an account.
 */
export const ACCOUNTS_ENABLED =
	env.VITE_RECORDLY_ACCOUNTS === "1" &&
	configured(env.VITE_SUPABASE_URL) &&
	configured(env.VITE_SUPABASE_PUBLISHABLE_KEY);

/** Cloud sharing also needs the hosted recording service. */
export const CLOUD_SHARE_ENABLED = ACCOUNTS_ENABLED && configured(env.VITE_CLOUD_SHARE_ENDPOINT);

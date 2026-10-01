-- Run in a private operator environment during the account-change freeze.
-- Redirect the single JSON value to a 0600 file outside this public repository.
-- Replace the project reference below; no credentials belong in this file.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'schemaVersion', 1,
  'source', jsonb_build_object(
    'projectRef', 'REPLACE_WITH_SOURCE_PROJECT_REF',
    'exportedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'frozen', true,
    'expectedUserCount', (SELECT count(*) FROM auth.users),
    'expectedIdentityCount', (SELECT count(*) FROM auth.identities)
  ),
  'users', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'email', email, 'encrypted_password', encrypted_password,
    'email_confirmed_at', email_confirmed_at, 'created_at', created_at,
    'updated_at', updated_at, 'banned_until', banned_until,
    'deleted_at', deleted_at, 'is_anonymous', is_anonymous,
    'is_sso_user', is_sso_user, 'phone', phone, 'phone_confirmed_at', phone_confirmed_at
  ) ORDER BY id) FROM auth.users), '[]'::jsonb),
  'identities', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'user_id', user_id, 'provider', provider,
    'provider_id', provider_id, 'subject', identity_data->>'sub',
    'created_at', created_at, 'updated_at', updated_at
  ) ORDER BY id) FROM auth.identities), '[]'::jsonb),
  'mfaFactors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'user_id', user_id, 'status', status, 'factor_type', factor_type
  ) ORDER BY id) FROM auth.mfa_factors), '[]'::jsonb)
);
COMMIT;

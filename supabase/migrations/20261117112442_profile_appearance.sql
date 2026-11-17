-- A data do commit que introduziu os perfis define o marco de fundador:
-- 17/11/2026 01:01:55 em São Paulo (04:01:55 UTC). Não muda em novas instalações.
BEGIN;
ALTER TABLE progresso_gang.profiles
  ADD COLUMN IF NOT EXISTS banner_id text REFERENCES progresso_gang.attachments(id),
  ADD COLUMN IF NOT EXISTS banner_crop text,
  ADD COLUMN IF NOT EXISTS appearance_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS custom_colors text,
  ADD COLUMN IF NOT EXISTS auto_palette text;

DO $constraints$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='progresso_gang.profiles'::regclass AND conname='profiles_appearance_mode_check') THEN
    ALTER TABLE progresso_gang.profiles ADD CONSTRAINT profiles_appearance_mode_check CHECK (appearance_mode IN ('auto','custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='progresso_gang.profiles'::regclass AND conname='profiles_banner_crop_check') THEN
    ALTER TABLE progresso_gang.profiles ADD CONSTRAINT profiles_banner_crop_check CHECK (banner_crop IS NULL OR banner_crop ~ '^(100|[0-9]{1,2}) (100|[0-9]{1,2}) (1[0-9]{2}|2[0-9]{2}|300)$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='progresso_gang.profiles'::regclass AND conname='profiles_custom_colors_check') THEN
    ALTER TABLE progresso_gang.profiles ADD CONSTRAINT profiles_custom_colors_check CHECK (custom_colors IS NULL OR custom_colors ~ '^#[0-9a-f]{6} #[0-9a-f]{6} #[0-9a-f]{6}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='progresso_gang.profiles'::regclass AND conname='profiles_auto_palette_check') THEN
    ALTER TABLE progresso_gang.profiles ADD CONSTRAINT profiles_auto_palette_check CHECK (auto_palette IS NULL OR auto_palette ~ '^#[0-9a-f]{6} #[0-9a-f]{6} #[0-9a-f]{6}$');
  END IF;
END $constraints$;
CREATE INDEX IF NOT EXISTS profiles_banner_id_idx ON progresso_gang.profiles(banner_id) WHERE banner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS progresso_gang.user_badges (
  user_id text NOT NULL REFERENCES progresso_gang.users(id),
  badge text NOT NULL CHECK (badge IN ('founder')),
  granted_at bigint NOT NULL,
  PRIMARY KEY (user_id,badge)
);
ALTER TABLE progresso_gang.user_badges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON progresso_gang.user_badges FROM PUBLIC, anon, authenticated;

ALTER TABLE progresso_gang.auth_links
  ADD COLUMN IF NOT EXISTS auth_created_at bigint,
  ADD COLUMN IF NOT EXISTS founder_checked integer NOT NULL DEFAULT 0 CHECK (founder_checked IN (0,1));

-- Apenas a data é copiada; nenhum e-mail ou outro dado do Auth é exposto.
UPDATE progresso_gang.auth_links AS link
SET auth_created_at = floor(extract(epoch FROM account.created_at) * 1000)::bigint
FROM auth.users AS account
WHERE account.id::text = link.auth_user_id AND account.email_confirmed_at IS NOT NULL
  AND lower(account.email) = lower(link.email);

INSERT INTO progresso_gang.user_badges(user_id,badge,granted_at)
SELECT link.user_id,'founder',floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
FROM progresso_gang.auth_links AS link
JOIN auth.users AS account ON account.id::text = link.auth_user_id
WHERE link.founder_checked=0 AND link.auth_created_at < 1794888115000
  AND account.email_confirmed_at IS NOT NULL AND lower(account.email) = lower(link.email)
ON CONFLICT(user_id,badge) DO NOTHING;
UPDATE progresso_gang.auth_links AS link SET founder_checked=1
FROM auth.users AS account
WHERE link.founder_checked=0 AND link.auth_created_at IS NOT NULL
  AND account.id::text = link.auth_user_id AND account.email_confirmed_at IS NOT NULL
  AND lower(account.email) = lower(link.email);
COMMIT;

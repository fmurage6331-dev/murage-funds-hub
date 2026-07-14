
-- Extend roles enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'chairman';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'treasurer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'secretary';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'assistant_secretary';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'board_member';

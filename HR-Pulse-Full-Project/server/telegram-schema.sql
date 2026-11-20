CREATE TABLE IF NOT EXISTS hr_telegram_hierarchies(site_id uuid PRIMARY KEY REFERENCES hr_records(id),data jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hr_telegram_accounts(actor text PRIMARY KEY,chat_id text UNIQUE NOT NULL,telegram_user_id text UNIQUE NOT NULL,linked_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE hr_telegram_accounts ADD COLUMN IF NOT EXISTS leave_connected boolean NOT NULL DEFAULT true;
ALTER TABLE hr_telegram_accounts ADD COLUMN IF NOT EXISTS trial_connected boolean NOT NULL DEFAULT false;
ALTER TABLE hr_telegram_accounts ADD COLUMN IF NOT EXISTS joining_connected boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS hr_telegram_link_tokens(hash text PRIMARY KEY,actor text NOT NULL,expires_at timestamptz NOT NULL);
ALTER TABLE hr_telegram_link_tokens ADD COLUMN IF NOT EXISTS bot text NOT NULL DEFAULT 'leave';
CREATE TABLE IF NOT EXISTS hr_telegram_updates(id bigint PRIMARY KEY,received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS hr_telegram_outbox(id bigserial PRIMARY KEY,event_key text NOT NULL,actor text NOT NULL,message text NOT NULL,state text NOT NULL DEFAULT 'PENDING',attempts integer NOT NULL DEFAULT 0,next_attempt timestamptz NOT NULL DEFAULT now(),last_error text,sent_at timestamptz,UNIQUE(event_key,actor));

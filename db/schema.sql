-- Strata PMS schema (PostgreSQL / Supabase)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  job_title text,
  practice text,
  role text NOT NULL CHECK (role IN ('employee','line_manager','overall_manager','calibration','cos','ceo')),
  line_manager_id uuid REFERENCES users(id),
  overall_manager_id uuid REFERENCES users(id),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS parent_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL CHECK (level IN ('company','practice','team')),
  practice text,
  owner_id uuid REFERENCES users(id),
  parent_id uuid REFERENCES parent_goals(id),
  title text NOT NULL,
  measure text,
  target text,
  fy int NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES users(id),
  fy int NOT NULL,
  quarter text NOT NULL CHECK (quarter IN ('Q1','Q2','Q3','Q4')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN
    ('draft','submitted','line_scored','om_approved','calibrated','cos_approved','ceo_approved')),
  proof_of_work_url text,
  evidence_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_total numeric(4,2),
  manager_total numeric(4,2),
  final_rating text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, fy, quarter)
);

CREATE TABLE IF NOT EXISTS kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  position int NOT NULL,
  category text NOT NULL,
  category_weight numeric(5,2) NOT NULL CHECK (category_weight BETWEEN 0 AND 100),
  kpi text NOT NULL,
  weight_in_category numeric(5,2) NOT NULL CHECK (weight_in_category BETWEEN 0 AND 100),
  self_score int CHECK (self_score BETWEEN 1 AND 5),
  manager_score int CHECK (manager_score BETWEEN 1 AND 5)
);

CREATE TABLE IF NOT EXISTS signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('line','om','cal','cos','ceo')),
  signer_id uuid NOT NULL REFERENCES users(id),
  decision text NOT NULL CHECK (decision IN ('approved','returned')),
  signed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evaluation_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id uuid NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid REFERENCES evaluation_comments(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  scorecard_id uuid REFERENCES scorecards(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id),
  actor_label text,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scorecards_employee ON scorecards(employee_id);
CREATE INDEX IF NOT EXISTS idx_scorecards_status ON scorecards(status);
CREATE INDEX IF NOT EXISTS idx_kpis_scorecard ON kpis(scorecard_id);
CREATE INDEX IF NOT EXISTS idx_audit_scorecard ON audit_logs(scorecard_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_scorecard ON evaluation_comments(scorecard_id);
CREATE INDEX IF NOT EXISTS idx_users_line ON users(line_manager_id);
CREATE INDEX IF NOT EXISTS idx_users_overall ON users(overall_manager_id);

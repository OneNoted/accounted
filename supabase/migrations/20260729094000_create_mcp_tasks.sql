-- Migration: MCP Tasks (io.modelcontextprotocol/tasks extension)
-- Durable handles for long-running MCP tool calls: the tool call returns a
-- task handle immediately and the work completes after the response; clients
-- poll tasks/get until a terminal status. Writes go through the service-role
-- MCP handler only (mirrors pending_operations); company members may read.

CREATE TABLE public.mcp_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Attribution only (which API key created the task); deliberately no FK so
  -- key rotation or deletion never breaks task history.
  api_key_id       UUID,
  tool_name        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'working' CHECK (status IN (
    'working', 'input_required', 'completed', 'failed', 'cancelled'
  )),
  status_message   TEXT,
  -- Terminal payloads: `result` holds exactly what the synchronous tool call
  -- would have returned (a CallToolResult, including isError envelopes);
  -- `error` holds a JSON-RPC error object for infrastructure failures.
  result           JSONB,
  error            JSONB,
  poll_interval_ms INTEGER NOT NULL DEFAULT 2000,
  ttl_ms           BIGINT NOT NULL DEFAULT 3600000,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 hour'
);

-- tasks/get looks up by id + creator; expiry cleanup scans expires_at.
CREATE INDEX idx_mcp_tasks_user ON public.mcp_tasks (user_id, status);
CREATE INDEX idx_mcp_tasks_company ON public.mcp_tasks (company_id);
CREATE INDEX idx_mcp_tasks_expires ON public.mcp_tasks (expires_at);

ALTER TABLE public.mcp_tasks ENABLE ROW LEVEL SECURITY;

-- Reads: company members can see their companies' tasks.
CREATE POLICY "mcp_tasks_select_company" ON public.mcp_tasks
  FOR SELECT USING (company_id IN (SELECT user_company_ids()));

-- No INSERT/UPDATE/DELETE policies: all writes go through the service-role
-- MCP handler (mirrors pending_operations). Rows age out via expires_at.

CREATE TRIGGER mcp_tasks_updated_at
  BEFORE UPDATE ON public.mcp_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- No audit trigger: operational task plumbing, not business records. The
-- underlying tool executions already emit mcp.tool_called telemetry, and any
-- committed bookkeeping effects carry their own audit trail.

NOTIFY pgrst, 'reload schema';

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/check-ins/service", () => ({ ensureGhlContactId: vi.fn() }));

import type { InboundMessage } from "@/lib/ghl/inbound";
import type { TeamMember } from "@/types/domain";

import { buildTools, type AgentInput, type SenderKind } from "./agent";
import { hashToken } from "./links";

const inbound: InboundMessage = {
  channel: "sms",
  contactId: "c_1",
  conversationId: null,
  messageId: null,
  phone: "+15550001111",
  email: null,
  name: "Pat",
  subject: null,
  body: "hello",
};

const member = { id: "m_1", name: "Pat", is_manager: false, timezone: "America/New_York" } as TeamMember;

function toolNames(senderKind: SenderKind, m: TeamMember | null) {
  const input = { supabase: {}, runId: "r", inbound, senderKind, member: m, senderFacts: [], history: [] } as unknown as AgentInput;
  return buildTools(input, [], { replied: false }).map((t) => t.name);
}

describe("agent tools by sender", () => {
  it("customers only get reply and escalate", () => {
    expect(toolNames("customer", null)).toEqual(["reply_to_sender", "escalate_to_managers"]);
    expect(toolNames("unknown", null)).toEqual(["reply_to_sender", "escalate_to_managers"]);
  });

  it("employees can look up jobs, get links and see their own check-ins", () => {
    expect(toolNames("team", member)).toEqual([
      "reply_to_sender",
      "escalate_to_managers",
      "list_open_jobs",
      "send_job_link",
      "get_check_ins",
    ]);
  });

  it("managers can also direct the team and approve drafts", () => {
    expect(toolNames("manager", { ...member, is_manager: true })).toEqual([
      "reply_to_sender",
      "escalate_to_managers",
      "list_open_jobs",
      "send_job_link",
      "get_check_ins",
      "list_team",
      "message_team_member",
      "list_pending_drafts",
      "send_draft",
      "discard_draft",
      "recent_activity",
    ]);
  });
});

describe("employee link tokens", () => {
  it("stores a stable sha256 hash, never the token", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

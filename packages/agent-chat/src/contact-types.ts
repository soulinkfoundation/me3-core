export type AgentContactSource =
  | "booking"
  | "manual"
  | "agent"
  | "import"
  | "outreach"
  | "soulink";

export type AgentContactRelationship = "client" | "prospect" | "contact";

export type AgentContactStatus = "active" | "archived" | "dormant";

export type AgentContactCloseness = "very_close" | "close" | "acquaintance" | null;

export type AgentContactOutreachStatus =
  | "new"
  | "drafted"
  | "sent"
  | "replied"
  | "booked"
  | "converted"
  | "not_interested"
  | "no_response"
  | null;

export type AgentContactInput = Partial<{
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  sourceRef: string | null;
  relationship: AgentContactRelationship;
  closeness: AgentContactCloseness;
  status: AgentContactStatus;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  nextFollowupAt: string | null;
  outreachStatus: AgentContactOutreachStatus;
  socialHandles: Record<string, string>;
  metadata: Record<string, unknown> | null;
}>;

export type AgentContact = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  sourceRef: string | null;
  relationship: AgentContactRelationship;
  closeness: string | null;
  status: AgentContactStatus;
  notes: string | null;
  tags: string[];
  lastInteractionAt: string | null;
  nextFollowupAt: string | null;
  outreachStatus: AgentContactOutreachStatus;
  socialHandles: Record<string, string>;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  bookingCount: number;
  lastBookingAt: string | null;
  isClose: boolean;
  closeSince: string | null;
  isClient: boolean;
  lastInTouchAt: string | null;
  reminderAt: string | null;
};

export type AgentContactsSummary = {
  total: number;
  clients: number;
  contacts: number;
  active: number;
  archived: number;
};

export type DbContactRow = {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: AgentContactSource;
  source_ref: string | null;
  relationship: AgentContactRelationship;
  status: AgentContactStatus;
  notes: string | null;
  tags: string | null;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  outreach_status: AgentContactOutreachStatus;
  social_handles: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  booking_count?: number | string | null;
  last_booking_at?: string | null;
  is_client?: number | string | null;
  reminder_at?: string | null;
};

import type { DbSchedulingRequest } from "./types";

const columns = ["contact_id", "time_type_id", "status", "requester_name", "target_name", "reason", "date_range_start", "date_range_end", "candidate_slots_json", "selected_slot_json", "policy_json", "requester_approved_at", "target_approved_at", "finalized_calendar_event_id", "finalized_booking_id", "finalized_at", "updated_at"] as const;
export const schedulingRequestPrecondition = columns.map(column => `AND ${column} IS ?`).join(" ");
export function schedulingRequestValues(request: DbSchedulingRequest): unknown[] { return columns.map(column => request[column]); }
export function sameSchedulingRequest(first: DbSchedulingRequest, second: DbSchedulingRequest) { return first.id === second.id && first.user_id === second.user_id && JSON.stringify(schedulingRequestValues(first)) === JSON.stringify(schedulingRequestValues(second)); }

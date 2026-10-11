import { describe, expect, it } from "vitest";
import { normalizeAgentTargetPresentation, targetChoiceRequest } from "./agentTargetChoices";

const presentation = {
  id: "presentation-1", actionLabel: "Move reminder", status: "pending",
  expiresAt: "2099-01-01T00:00:00.000Z",
  changes: [{ label: "Date", value: "2027-01-16" }],
  candidates: [
    { id: "jan15", option: 1, label: "Launch review", fields: [{ label: "Originally due", value: "2027-01-15T12:00Z" }] },
    { id: "jan17", option: 2, label: "Launch review", fields: [{ label: "Originally due", value: "2027-01-17T12:00Z" }] },
  ],
};

describe("authoritative target choices", () => {
  it("retains exact server ordering, labels, source attributes and proposed change", () => {
    expect(normalizeAgentTargetPresentation(presentation)).toEqual(presentation);
  });
  it("sends the chosen stable ID and presentation identity, without copying action arguments", () => {
    expect(targetChoiceRequest(presentation, "jan17")).toEqual({ presentationId: "presentation-1", candidateId: "jan17" });
  });
  it("does not submit unknown, superseded or expired choices", () => {
    expect(targetChoiceRequest(presentation, "invented")).toBeNull();
    expect(targetChoiceRequest({ ...presentation, status: "unavailable" }, "jan17")).toBeNull();
    expect(targetChoiceRequest({ ...presentation, expiresAt: "2000-01-01T00:00:00Z" }, "jan17")).toBeNull();
  });
  it("rejects malformed or conflicting menus without silently renumbering them", () => {
    expect(normalizeAgentTargetPresentation({ ...presentation, candidates: [presentation.candidates[1], presentation.candidates[0]] })).toBeNull();
    expect(normalizeAgentTargetPresentation({ ...presentation, candidates: [presentation.candidates[0], { ...presentation.candidates[1], id: "jan15" }] })).toBeNull();
    expect(normalizeAgentTargetPresentation({ ...presentation, changes: [{ label: "Date", value: {} }] })).toBeNull();
  });
});

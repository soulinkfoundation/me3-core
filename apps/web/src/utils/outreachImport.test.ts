import { describe, expect, it } from "vitest";
import { importBatches, parseProspectList } from "./outreachImport";

// Failure modes: a comma inside a quoted cell splits the row; a list pasted from
// a spreadsheet (tabs) lands in one column; the owner's own column names are not
// recognised; an Irish date is read month-first; a list with no header loses its
// first row; blank or nameless rows are imported as empty people.
describe("reading a pasted or uploaded list of prospects", () => {
  it("reads a CSV with the owner's own column names, quoted commas and line breaks", () => {
    const parsed = parseProspectList(
      [
        "Association,Contact Name,E-mail,What was offered,Stage,Next follow up,Comments",
        'IACP,Mary Byrne,Office@IACP.example,"Member discount, 20%",Sent,20/11/2026,"Met at the AGM',
        'Call after 2pm"',
        ",,,,,,",
        "IMTA,,office@imta.example,,Agreed,2026-12-01,",
      ].join("\n"),
    );

    expect(parsed.rows).toEqual([
      {
        name: "Mary Byrne",
        email: "office@iacp.example",
        organisation: "IACP",
        offer: "Member discount, 20%",
        status: "Sent",
        followUpAt: "2026-11-20",
        notes: "Met at the AGM\nCall after 2pm",
      },
      { name: "IMTA", email: "office@imta.example", organisation: "IMTA", status: "Agreed", followUpAt: "2026-12-01" },
    ]);
    expect(parsed.unnamed).toBe(0);
  });

  it("reads rows pasted from a spreadsheet, and a plain list with no header", () => {
    expect(parseProspectList("Name\tEmail\nISME\toffice@isme.example\n").rows).toEqual([
      { name: "ISME", email: "office@isme.example" },
    ]);
    expect(parseProspectList("Irish Yoga Association\nYoga Therapy Ireland, hello@yti.example\n").rows).toEqual([
      { name: "Irish Yoga Association" },
      { name: "Yoga Therapy Ireland", email: "hello@yti.example" },
    ]);
    expect(parseProspectList("Mary Byrne <mary@iacp.example>").rows).toEqual([
      { name: "Mary Byrne", email: "mary@iacp.example" },
    ]);
  });

  it("counts rows it cannot name, drops unreadable dates, and reads day-first dates", () => {
    const parsed = parseProspectList("Name,Email,Follow up\n,,someday\nICF Ireland,,3.12.2026\nIMTA,,12/25/2026\n,x@y.example,\n");
    expect(parsed.rows).toEqual([
      { name: "ICF Ireland", followUpAt: "2026-12-03" },
      { name: "IMTA", followUpAt: "2026-12-25" },
      { name: "x@y.example", email: "x@y.example" },
    ]);
    expect(parsed.unnamed).toBe(1);
    expect(parseProspectList("  \n").rows).toEqual([]);
  });

  // Failure mode: a Phone, Tel or Mobile column is ignored, so numbers never reach People.
  it("reads a phone column under the owner's own heading", () => {
    expect(parseProspectList("Organisation,Phone\nAFPA,01 412 4917\n").rows).toEqual([
      { name: "AFPA", organisation: "AFPA", phone: "01 412 4917" },
    ]);
    expect(parseProspectList("Name\tTel\tMobile\nIHF\t\t087 118 0351\n").rows).toEqual([
      { name: "IHF", phone: "087 118 0351" },
    ]);
  });

  it("splits a long list into batches the server accepts", () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({ name: `Org ${index}` }));
    expect(importBatches(rows).map((batch) => batch.length)).toEqual([50, 50, 20]);
  });
});

import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import JournalNotesTree from "./JournalNotesTree.vue";

type Note = { id: string; title: string | null; updatedAt: string; projectId?: string | null; folderId?: string | null };

const notes: Note[] = [
  { id: "n1", title: "Loose note", updatedAt: "2026-11-20T10:00:00Z", projectId: null, folderId: null },
  { id: "n2", title: "Filed note", updatedAt: "2026-11-20T10:00:00Z", projectId: "p1", folderId: "f1" },
];

function mountTree() {
  return mount(JournalNotesTree, {
    props: {
      notes,
      folders: [{ id: "f1", name: "Drafts", projectId: "p1" }],
      projects: [{ id: "p1", name: "Book" }],
      activeId: null,
      wordCount: () => 0,
      subtitle: () => "",
    },
    global: { stubs: { UiIcon: true, ProjectIcon: true } },
  });
}

function dataTransfer() {
  const data = new Map<string, string>();
  return { effectAllowed: "", dropEffect: "", setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? "" };
}

const row = (wrapper: ReturnType<typeof mountTree>, title: string) => wrapper.findAll(".notes-tree__row").find((item) => item.text().includes(title))!;
const head = (wrapper: ReturnType<typeof mountTree>, name: string) => wrapper.findAll(".notes-tree__head").find((item) => item.text().includes(name))!;

describe("JournalNotesTree drag and drop", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("moves a dragged note into the folder it is dropped on", async () => {
    const wrapper = mountTree();
    const transfer = dataTransfer();
    await row(wrapper, "Loose note").trigger("dragstart", { dataTransfer: transfer });
    await head(wrapper, "Drafts").trigger("dragover", { dataTransfer: transfer });
    expect(head(wrapper, "Drafts").classes()).toContain("is-drop-target");
    await head(wrapper, "Drafts").trigger("drop", { dataTransfer: transfer });

    expect(wrapper.emitted("move")).toEqual([[notes[0], { projectId: "p1", folderId: "f1" }]]);
    expect(head(wrapper, "Drafts").classes()).not.toContain("is-drop-target");
  });

  it("moves a note out of its folder onto a project", async () => {
    const wrapper = mountTree();
    const transfer = dataTransfer();
    await row(wrapper, "Filed note").trigger("dragstart", { dataTransfer: transfer });
    await head(wrapper, "No project").trigger("drop", { dataTransfer: transfer });

    expect(wrapper.emitted("move")).toEqual([[notes[1], { projectId: null, folderId: null }]]);
  });

  it("ignores a drop on the note's current place", async () => {
    const wrapper = mountTree();
    const transfer = dataTransfer();
    await row(wrapper, "Filed note").trigger("dragstart", { dataTransfer: transfer });
    await head(wrapper, "Drafts").trigger("dragover", { dataTransfer: transfer });
    expect(head(wrapper, "Drafts").classes()).not.toContain("is-drop-target");
    await head(wrapper, "Drafts").trigger("drop", { dataTransfer: transfer });

    expect(wrapper.emitted("move")).toBeUndefined();
  });

  it("opens a collapsed folder when a note hovers over it", async () => {
    vi.useFakeTimers();
    const wrapper = mountTree();
    await head(wrapper, "Drafts").find(".notes-tree__toggle").trigger("click");
    expect(wrapper.text()).not.toContain("Filed note");

    const transfer = dataTransfer();
    await row(wrapper, "Loose note").trigger("dragstart", { dataTransfer: transfer });
    await head(wrapper, "Drafts").trigger("dragover", { dataTransfer: transfer });
    await vi.advanceTimersByTimeAsync(700);

    expect(wrapper.text()).toContain("Filed note");
  });
});

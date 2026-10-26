// Notes in the Journal library are grouped by project, with one level of folders inside
// each project (me3-y6ai). No project comes last and has its own folders.

export type NotePlacement = { projectId: string | null; folderId: string | null };

export type NoteLike = { id: string; updatedAt: string; projectId?: string | null; folderId?: string | null };
export type NoteFolder = { id: string; name: string; projectId: string | null };
export type NoteProject = { id: string; name: string };

export type NoteFolderGroup<T> = { folder: NoteFolder; notes: T[] };
export type NoteProjectGroup<T> = {
  key: string;
  projectId: string | null;
  name: string;
  folders: NoteFolderGroup<T>[];
  notes: T[];
  count: number;
};

export function groupNotes<T extends NoteLike>(notes: T[], folders: NoteFolder[], projects: NoteProject[]): NoteProjectGroup<T>[] {
  const known = new Set(projects.map((project) => project.id));
  const projectOf = (projectId: string | null | undefined) => (projectId && known.has(projectId) ? projectId : null);
  const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  const build = (projectId: string | null, name: string): NoteProjectGroup<T> => {
    const inProject = sorted.filter((note) => projectOf(note.projectId) === projectId);
    const folderGroups = sortedFolders
      .filter((folder) => projectOf(folder.projectId) === projectId)
      .map((folder) => ({ folder, notes: inProject.filter((note) => note.folderId === folder.id) }));
    const filed = new Set(folderGroups.flatMap((group) => group.notes.map((note) => note.id)));
    return {
      key: projectId ?? "none",
      projectId,
      name,
      folders: folderGroups,
      notes: inProject.filter((note) => !filed.has(note.id)),
      count: inProject.length,
    };
  };

  return [...projects.map((project) => build(project.id, project.name)), build(null, "No project")]
    .filter((group) => group.count > 0 || group.folders.length > 0);
}

export function samePlacement(a: NotePlacement, b: NotePlacement) {
  return (a.projectId ?? null) === (b.projectId ?? null) && (a.folderId ?? null) === (b.folderId ?? null);
}

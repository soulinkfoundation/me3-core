import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { generateSiteHtml, markdownToHtml } from "@me3-core/site-renderer";
import { exportSiteContentToMarkdown } from "../utils/siteContentAssets";
import TiptapEditor from "./TiptapEditor.vue";

// The unrelated emoji picker initializes IndexedDB on import.
vi.mock("vue3-emoji-picker", () => ({ default: { template: "<div />" } }));

describe("site content save and reopen", () => {
  it("keeps Markdown formatting and gallery captions through repeated real editor saves", async () => {
    let saved = 'First paragraph.\n\nSecond paragraph.\n\n### Current work\n\n[**Project**](https://example.com)\n\n<div data-gallery="true"><figure data-tiptap-image="true"><img src="./files/badge.png" alt="Badge" data-image-id="badge"><figcaption>Certificate</figcaption></figure></div>\n\n## After the gallery\n\nMore text.';

    for (let cycle = 0; cycle < 3; cycle += 1) {
      // The content API uses this same renderer when reopening saved .md files.
      const wrapper = mount(TiptapEditor, {
        props: { modelValue: markdownToHtml(saved) },
        attachTo: document.body,
      });
      try {
        await flushPromises();
        expect(wrapper.get(".ProseMirror h3").text()).toBe("Current work");
        expect(wrapper.get('.ProseMirror a[href="https://example.com"] strong').text()).toBe("Project");
        expect(wrapper.findAll(".ProseMirror p").map(p => p.text())).toEqual(expect.arrayContaining(["First paragraph.", "Second paragraph."]));
        const editor = wrapper.vm.editor!;
        editor.commands.insertContentAt(editor.state.doc.content.size, `<p>Edit ${cycle + 1}.</p>`);
        await flushPromises();
        const updates = wrapper.emitted("update:modelValue")!;
        saved = exportSiteContentToMarkdown(updates[updates.length - 1][0] as string, []).markdown;
        expect(saved).toContain("### Current work");
        expect(saved).toContain("[**Project**](https://example.com)");
        expect(saved).toContain('data-gallery="true"');
        expect(saved).toContain("Certificate</figcaption>");
        expect(saved).not.toContain("\\[\\*\\*");

        const files = await generateSiteHtml({ name: "Example", pages: [{ slug: "about", title: "About", file: "about.md" }] }, [{ name: "about.md", content: saved }]);
        const page = new DOMParser().parseFromString(files["about.html"], "text/html");
        expect(page.querySelector("main h3")?.textContent).toBe("Current work");
        expect(page.querySelector('main a[href="https://example.com"] strong')?.textContent).toBe("Project");
        expect(page.querySelector("main figcaption")?.textContent).toBe("Certificate");
        expect(page.querySelectorAll("main img")).toHaveLength(1);
        expect(page.querySelector("main")?.textContent).not.toContain("###");
      } finally {
        wrapper.unmount();
      }
    }
  });
});

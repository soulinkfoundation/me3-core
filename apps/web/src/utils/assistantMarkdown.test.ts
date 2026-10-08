import { describe, expect, it } from "vitest";
import { renderAssistantMarkdown } from "./assistantMarkdown";

describe("renderAssistantMarkdown", () => {
  it("renders h1 through h3 headings", () => {
    expect(renderAssistantMarkdown("# One\n\n## Two\n\n### Three")).toBe(
      "<h1>One</h1><h2>Two</h2><h3>Three</h3>",
    );
  });

  it("renders common chat markdown blocks and inline marks", () => {
    expect(
      renderAssistantMarkdown(
        [
          "**Summary**",
          "",
          "- first",
          "- _second_",
          "",
          "1. ordered",
          "2. `code`",
          "",
          "> quoted",
          "",
          "---",
        ].join("\n"),
      ),
    ).toBe(
      "<p><strong>Summary</strong></p><ul><li>first</li><li><em>second</em></li></ul><ol><li>ordered</li><li><code>code</code></li></ol><blockquote><p>quoted</p></blockquote><hr>",
    );
  });

  it("keeps wrapped and nested items under their parent bullet", () => {
    expect(renderAssistantMarkdown("- First line\n  continuation\n  - Nested\n- Second")).toBe(
      "<ul><li>First line<br>continuation<ul><li>Nested</li></ul></li><li>Second</li></ul>",
    );
  });

  it("escapes unsafe html and link protocols", () => {
    expect(
      renderAssistantMarkdown(
        '<script>alert("x")</script> [safe](/assistant) [bad](javascript:alert(1))',
      ),
    ).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; <a href="/assistant" target="_blank" rel="noopener noreferrer">safe</a> [bad](javascript:alert(1))</p>',
    );
  });

  it("preserves fenced code as escaped preformatted text", () => {
    expect(renderAssistantMarkdown("```ts\nconst x = '<tag>';\n```")).toBe(
      "<pre><code>const x = &#39;&lt;tag&gt;&#39;;</code></pre>",
    );
  });

  it("renders rich-text HTML embedded in task results", () => {
    expect(renderAssistantMarkdown("- Order a nuc of bees: <p>Ask donough</p>")).toBe(
      "<ul><li>Order a nuc of bees: Ask donough</li></ul>",
    );
  });
});

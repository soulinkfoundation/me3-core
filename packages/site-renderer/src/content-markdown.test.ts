import { describe, expect, it } from "vitest";
import { generateSiteHtml, markdownToHtml } from "./index";

const prose = "First paragraph.\n\nSecond paragraph.\n\n### Current work\n\n[**Project**](https://example.com) and *coaching*.";
const gallery = '<div data-gallery="true"><figure data-tiptap-image="true"><img src="/files/badge.png" alt="Badge"><figcaption>Certificate</figcaption></figure></div>';

describe("mixed Markdown and rich content", () => {
  it.each([
    gallery,
    '<figure data-me3-audio="true"><audio controls><source src="/files/practice.mp3" type="audio/mpeg"></audio></figure>',
    '<div data-tiptap-faq="true"><div><p>Answer with literal **stars**.</p></div></div>',
    '<div data-tiptap-carousel="true"><div><div>Card</div></div></div>',
    '<div data-me3-site-block="newsletter">​</div>',
    '<div data-me3-cta-button="true" data-text="Book > now">​</div>',
    '<div data-tiptap-youtube="true"><iframe src="https://www.youtube.com/embed/example"></iframe></div>',
  ])("parses prose before and after a preserved HTML block: %s", (block) => {
    for (const source of [`${prose}\n\n${block}\n\n## After\n\n- One\n- Two`, `${block}\n\n${prose}`]) {
      const html = markdownToHtml(source);
      expect(html).toContain("<p>First paragraph.</p>");
      expect(html).toContain("<p>Second paragraph.</p>");
      expect(html).toContain("<h3>Current work</h3>");
      expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener"><strong>Project</strong></a>');
      expect(html).toContain("<em>coaching</em>");
      expect(html).toContain(block.replaceAll('src="/files/', 'src="./files/'));
      expect(html).not.toContain("### Current work");
      expect(html).not.toContain("[**Project**]");
    }
  });

  it("preserves multiline nested blocks and continues parsing afterwards", () => {
    const block = '<div data-gallery="true">\n\n<div><figure><img src="/files/badge.png"></figure></div>\n\n</div>';
    expect(markdownToHtml(`${block}\n\n## After\n\n- One\n- Two`, "../")).toBe(
      block.replace('/files/', '../files/') + '\n<h2>After</h2>\n<ul><li>One</li><li>Two</li></ul>',
    );
  });

  it("keeps existing HTML paragraphs, links and literal syntax intact", () => {
    const html = '<p>Literal **stars** and <a href="https://example.com">a link</a>.</p><pre><code>### Example</code></pre>';
    expect(markdownToHtml(html)).toBe(html);
  });

  it("keeps inline HTML within formatted paragraphs and comments out of prose", () => {
    expect(markdownToHtml('Hello **reader** and <span title="a > b">friend</span>.\n\n<!-- <div>ignored</div> -->\n\n## Next')).toBe('<p>Hello <strong>reader</strong> and <span title="a > b">friend</span>.</p>\n<!-- <div>ignored</div> -->\n<h2>Next</h2>');
  });

  it("does not confuse angle-bracket links or marker-like text with HTML", () => {
    const html = markdownToHtml(`ME3HTMLBLOCK0END\n\n[Email](<mailto: hello@example.com>)\n\n${gallery}`);
    expect(html).toContain('<p>ME3HTMLBLOCK0END</p>');
    expect(html).toContain('<a href="mailto:hello@example.com">Email</a>');
  });

  it("preserves raw HTML content containing tag-like text", () => {
    const block = '<div><script>if (a < b) console.log("<div>");</script><textarea>Literal <div> and **stars**</textarea></div>';
    expect(markdownToHtml(`${block}\n\n## Next`)).toBe(`${block}\n<h2>Next</h2>`);
  });

  it("renders formatted public pages, posts and products with their media", async () => {
    const files = await generateSiteHtml({
      name: "Example",
      pages: [{ slug: "about", title: "About", file: "about.md" }],
      posts: [{ slug: "news", title: "News", file: "blog/news.md" }],
      products: [{ slug: "guide", title: "Guide", file: "shop/guide.md", price: 1000, currency: "EUR" }],
    }, ["about.md", "blog/news.md", "shop/guide.md"].map(name => ({ name, content: `${prose}\n\n${gallery}` })));
    for (const path of ["about.html", "blog/news.html", "shop/guide.html"]) {
      expect(files[path]).toContain("<h3>Current work</h3>");
      expect(files[path]).toContain("<strong>Project</strong></a>");
      expect(files[path]).toContain("Certificate</figcaption>");
      expect(files[path]).not.toContain("### Current work");
    }
  });
});

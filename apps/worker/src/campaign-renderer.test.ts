import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_DOCUMENT_VERSION,
  CampaignDocumentValidationError,
  createEmptyCampaignDocument,
  parseCampaignDocument,
  type CampaignDocumentV1,
} from "../../../shared/campaign-document";
import { campaignLayoutDocumentBlocks, campaignLayouts } from "../../../shared/campaign-layouts";
import { contrastRatio } from "../../../shared/campaign-brand";
import { renderCampaign, renderCampaignLayoutPreview } from "./campaign-renderer";

function documentFixture(): CampaignDocumentV1 {
  return {
    ...createEmptyCampaignDocument({
      name: "Example Studio",
      homeUrl: "https://example.com",
      logoUrl: "https://example.com/logo.png",
      accentColor: "#147d64",
    }),
    blocks: [
      {
        id: "intro",
        type: "text",
        paragraphs: [
          { style: "heading1", spans: [{ text: "A useful update" }] },
          {
            style: "body",
            spans: [
              { text: "Hello ", marks: ["bold"] },
              { text: "readers", link: "https://example.com/read" },
            ],
          },
          { style: "bullet", spans: [{ text: "One clear point" }] },
        ],
      },
      {
        id: "hero-image",
        type: "image",
        assetId: "asset-1",
        src: "https://example.com/campaign-assets/asset-1/hero.png",
        alt: "A calm workspace",
        caption: "Made for focused work",
      },
      {
        id: "primary-action",
        type: "button",
        label: "Read more",
        href: "https://example.com/story",
        alignment: "center",
      },
      { id: "divider", type: "divider" },
      { id: "space", type: "spacer", size: "small" },
    ],
  };
}

describe("campaign document", () => {
  it("normalizes brand defaults without storing arbitrary markup", () => {
    expect(createEmptyCampaignDocument({ name: "Owner" })).toEqual({
      version: CAMPAIGN_DOCUMENT_VERSION,
      brand: {
        name: "Owner",
        homeUrl: "https://me3.app/",
        logoUrl: null,
        logoAlignment: "center",
        backgroundColor: "#f4f5f4",
        surfaceColor: "#ffffff",
        textColor: "#18201d",
        accentColor: "#147d64",
      },
      blocks: [],
    });
  });

  it("rejects unsupported content and unsafe URLs", () => {
    expect(() =>
      parseCampaignDocument({
        ...documentFixture(),
        blocks: [
          { id: "raw", type: "html", html: "<script>alert(1)</script>" },
          { id: "button", type: "button", label: "Open", href: "javascript:alert(1)" },
        ],
      }),
    ).toThrow(CampaignDocumentValidationError);
  });
});

describe("campaign renderer", () => {
  it("ends with one quiet unsubscribe line and no second sender link", () => {
    const rendered = renderCampaign({
      document: documentFixture(),
      unsubscribeUrl: "https://example.com/unsubscribe",
    });

    expect(rendered.html.match(/Unsubscribe<\/a>/g)).toHaveLength(1);
    expect(rendered.html).toContain("You're getting this because you subscribed to Example Studio.");
    expect(rendered.html).not.toContain("Sent by");
    expect(rendered.text).toContain(
      "You're getting this because you subscribed to Example Studio. Unsubscribe: https://example.com/unsubscribe",
    );
  });

  it("produces deterministic table-based HTML and useful plain text", () => {
    const first = renderCampaign({
      document: documentFixture(),
      previewText: "The short preview",
      unsubscribeUrl: "{{unsubscribe_url}}",
    });
    const second = renderCampaign({
      document: documentFixture(),
      previewText: "The short preview",
      unsubscribeUrl: "{{unsubscribe_url}}",
    });

    expect(first).toEqual(second);
    expect(first.rendererVersion).toBe("me3.email-renderer.v4");
    expect(first.html).toContain('role="presentation"');
    expect(first.html).toContain("The short preview");
    expect(first.html).toContain("A useful update");
    expect(first.html).toContain("{{unsubscribe_url}}");
    expect(first.html).toContain('<img src="https://example.com/logo.png" alt="Example Studio"');
    expect(first.html).toContain('align="center"');
    expect(first.text.startsWith("Example Studio")).toBe(false);
    expect(first.text).toContain("• One clear point");
    expect(first.text).toContain("Read more: https://example.com/story");
  });

  it("escapes owner content before rendering", () => {
    const document = documentFixture();
    document.blocks = [
      {
        id: "unsafe-text",
        type: "text",
        paragraphs: [{ style: "body", spans: [{ text: '<script>alert("x")</script>' }] }],
      },
    ];
    const rendered = renderCampaign({
      document,
      unsubscribeUrl: "{{unsubscribe_url}}",
    });

    expect(rendered.html).not.toContain("<script>alert");
    expect(rendered.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("shows the Site logo at the top, linking to the site, or the name in bold without one", () => {
    const withLogo = renderCampaign({ document: documentFixture(), unsubscribeUrl: "#" }).html;
    expect(withLogo).toMatch(/<a href="https:\/\/example\.com\/" style="text-decoration:none"><img src="https:\/\/example\.com\/logo\.png"[^>]*width="200"/);

    const document = documentFixture();
    document.brand.logoUrl = null;
    const withoutLogo = renderCampaign({ document, unsubscribeUrl: "#" }).html;
    expect(withoutLogo).not.toContain("<img src=\"https://example.com/logo.png\"");
    expect(withoutLogo).toMatch(/<a href="https:\/\/example\.com\/" class="me3-txt"[^>]*font-weight:700[^>]*>Example Studio<\/a>/);
  });

  it("puts the footer below the card, centred, with the mailing address on its own line", () => {
    const document = documentFixture();
    document.brand.mailingAddress = "PO Box 12, Dublin 2, Ireland";
    const { html, text } = renderCampaign({ document, unsubscribeUrl: "https://example.com/u" });
    const cardEnd = html.indexOf("</table>\n      </td>\n    </tr>");
    const footer = html.indexOf("You're getting this because");
    expect(cardEnd).toBeGreaterThan(0);
    expect(footer).toBeGreaterThan(cardEnd);
    expect(html).toContain('Unsubscribe</a><br>PO Box 12, Dublin 2, Ireland</td>');
    expect(html.slice(html.lastIndexOf("<td", footer), footer)).toContain('align="center"');
    expect(text.endsWith("PO Box 12, Dublin 2, Ireland")).toBe(true);
  });

  it("carries the dark version, Outlook.com copies and classic Outlook fallbacks", () => {
    const { html } = renderCampaign({ document: documentFixture(), unsubscribeUrl: "#" });
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain(".me3-card { background:#1c201f !important; }");
    expect(html).toContain(".me3-txt { color:#e6ebe8 !important; }");
    expect(html).toContain("[data-ogsc] .me3-txt");
    expect(html).toContain("[data-ogsb] .me3-card");
    expect(html).toContain("<!--[if mso]><style>* { font-family:Arial,Helvetica,sans-serif !important; }</style><![endif]-->");
    expect(html).toContain('bgcolor="#ffffff" class="me3-shell me3-card"');
    expect(html).toContain("mso-line-height-rule:exactly");
    expect(html).toContain("-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif");
  });

  it("keeps text, links and button labels readable whatever the brand colours are", () => {
    const document = documentFixture();
    document.brand.accentColor = "#f5d90a";
    document.brand.textColor = "#888888";
    document.brand.backgroundColor = "#202020";
    const { html } = renderCampaign({ document, unsubscribeUrl: "#" });
    const link = html.match(/class="me3-lnk" style="color:(#[0-9a-f]{6})/)?.[1] || "";
    expect(contrastRatio(link, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(html).toMatch(/<a href="https:\/\/example\.com\/story" style="[^"]*color:#111111/);
    expect(html).toContain("color:#18201d;font-family");
    expect(html).not.toContain("#888888");
    expect(html).toContain('<body class="me3-bg" style="margin:0;padding:0;background:#f4f5f4');
  });

  for (const layout of campaignLayouts({ businessName: "Willow Yoga", homeUrl: "https://willow.example/", month: "October" })) {
    for (const logo of [true, false]) {
      it(`renders the ${layout.name} layout ${logo ? "with" : "without"} a logo under 60 KB`, () => {
        const brand = {
          ...documentFixture().brand,
          name: "Willow Yoga",
          homeUrl: "https://willow.example/",
          logoUrl: logo ? "https://willow.example/files/email-logo.png?v=1" : null,
          ...(logo ? { logoWidth: 180, logoHeight: 48 } : {}),
          mailingAddress: "Unit 4, The Old Mill, Wicklow",
        };
        const sent = renderCampaign({
          document: { ...documentFixture(), brand, blocks: campaignLayoutDocumentBlocks(layout.blocks) },
          previewText: layout.subject,
          unsubscribeUrl: "{{unsubscribe_url}}",
        });
        expect(new TextEncoder().encode(sent.html).length).toBeLessThan(60_000);
        expect(sent.html).toContain("prefers-color-scheme: dark");
        expect(sent.html).not.toContain("Your photo");
        expect(sent.html).toMatchSnapshot();

        const thumbnail = renderCampaignLayoutPreview(brand, layout.blocks);
        expect(thumbnail).toContain("Your photo");
      });
    }
  }
});

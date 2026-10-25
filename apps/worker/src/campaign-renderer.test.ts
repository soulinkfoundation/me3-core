import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_DOCUMENT_VERSION,
  CampaignDocumentValidationError,
  createEmptyCampaignDocument,
  parseCampaignDocument,
  type CampaignDocumentV1,
} from "../../../shared/campaign-document";
import { renderCampaign } from "./campaign-renderer";

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
    expect(first.rendererVersion).toBe("me3.email-renderer.v3");
    expect(first.html).toContain('role="presentation"');
    expect(first.html).toContain("The short preview");
    expect(first.html).toContain("A useful update");
    expect(first.html).toContain("{{unsubscribe_url}}");
    expect(first.html).not.toContain("https://example.com/logo.png");
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
});
